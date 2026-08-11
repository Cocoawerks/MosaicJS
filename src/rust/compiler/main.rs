//! ibcompile — compiles Mosaic components into imperative JavaScript that
//! builds the DOM through a `h()` runtime.
//!
//! Two source kinds:
//!   `.ib`   markup + scoped `<style>`, compiled to a component function.
//!   `.js` / `.jsx`
//!           JavaScript whose JSX (typically a `View` subclass's `draw()`)
//!           is rewritten into `h()` calls.
//!
//! Usage:
//!   ibcompile <input.ib> [-o out.js] [--runtime <path/to/mosaic.js>] [--name App]
//!   ibcompile <dir> --outdir build [--runtime <path/to/mosaic.js>]

mod ast;
mod bundle;
mod codegen;
mod css;
mod jsx;
mod parser;

use std::path::{Path, PathBuf};
use std::process::ExitCode;

struct Args {
    input: PathBuf,
    out: Option<PathBuf>,
    outdir: Option<PathBuf>,
    runtime: String,
    name: Option<String>,
    /// Combine every module into one payload at this path, with a source map.
    bundle: Option<PathBuf>,
    /// Component the bundle default-exports.
    entry: String,
}

fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("ibcompile: {e}\n\n{USAGE}");
            return ExitCode::FAILURE;
        }
    };

    let result = if args.input.is_dir() {
        compile_dir(&args)
    } else {
        compile_one(&args.input, &args).map(|_| ())
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("ibcompile: {e}");
            ExitCode::FAILURE
        }
    }
}

const USAGE: &str = "usage: ibcompile <input.ib|input.js|input.jsx|dir> [-o out.js] [--outdir dir]\n\
                     \t[--bundle build/app.js [--entry Main]] [--runtime <path/to/mosaic.js>] [--name Component]";

fn parse_args() -> Result<Args, String> {
    let mut it = std::env::args().skip(1);
    let mut input = None;
    let mut out = None;
    let mut outdir = None;
    let mut runtime = "../src/js/runtime/mosaic.js".to_string();
    let mut name = None;
    let mut bundle = None;
    let mut entry = "Main".to_string();

    while let Some(a) = it.next() {
        match a.as_str() {
            "-o" | "--out" => out = Some(PathBuf::from(next(&mut it, "-o")?)),
            "--outdir" => outdir = Some(PathBuf::from(next(&mut it, "--outdir")?)),
            "--runtime" => runtime = next(&mut it, "--runtime")?,
            "--name" => name = Some(next(&mut it, "--name")?),
            "--bundle" => bundle = Some(PathBuf::from(next(&mut it, "--bundle")?)),
            "--entry" => entry = next(&mut it, "--entry")?,
            "-h" | "--help" => {
                println!("{USAGE}");
                std::process::exit(0);
            }
            other if other.starts_with('-') => return Err(format!("unknown flag `{other}`")),
            other => input = Some(PathBuf::from(other)),
        }
    }

    Ok(Args {
        input: input.ok_or("missing input path")?,
        out,
        outdir,
        runtime,
        name,
        bundle,
        entry,
    })
}

fn next(it: &mut impl Iterator<Item = String>, flag: &str) -> Result<String, String> {
    it.next().ok_or_else(|| format!("`{flag}` needs a value"))
}

fn compile_dir(args: &Args) -> Result<(), String> {
    let outdir = args
        .outdir
        .clone()
        .or_else(|| args.bundle.as_ref().and_then(|b| b.parent().map(|p| p.to_path_buf())))
        .ok_or("compiling a directory requires --outdir or --bundle")?;
    std::fs::create_dir_all(&outdir).map_err(|e| format!("{}: {e}", outdir.display()))?;

    let mut paths: Vec<PathBuf> = std::fs::read_dir(&args.input)
        .map_err(|e| format!("{}: {e}", args.input.display()))?
        .map(|e| e.map_err(|e| e.to_string()).map(|e| e.path()))
        .collect::<Result<Vec<_>, _>>()?;
    paths.retain(|p| {
        p.extension()
            .is_some_and(|e| e == "ib" || e == "jsx" || e == "js")
    });
    paths.sort();

    if paths.is_empty() {
        eprintln!(
            "ibcompile: no .ib, .js or .jsx files in {}",
            args.input.display()
        );
        return Ok(());
    }

    let mut modules = Vec::new();
    for path in &paths {
        modules.push(compile_one(path, args)?);
    }

    if let Some(target) = &args.bundle {
        let map_name = format!(
            "{}.map",
            target
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "bundle.js".into())
        );
        let base = args.input.parent().unwrap_or(Path::new(".")).to_path_buf();
        let out = bundle::bundle(modules, &args.runtime, &args.entry, &map_name, &base)?;

        std::fs::write(target, &out.code).map_err(|e| format!("{}: {e}", target.display()))?;
        let map_path = target.with_file_name(&map_name);
        std::fs::write(&map_path, &out.map).map_err(|e| format!("{}: {e}", map_path.display()))?;
        println!(
            "bundled {} modules -> {} (+ {})",
            paths.len(),
            target.display(),
            map_name
        );
    }
    Ok(())
}

fn compile_one(path: &Path, args: &Args) -> Result<bundle::Module, String> {
    let src = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;

    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Component".into());

    let js = if path.extension().is_some_and(|e| e == "jsx" || e == "js") {
        // Drawn views are scoped like .ib components: one attribute per module,
        // stamped on its elements and required by its stylesheet's selectors.
        let scope_attr = format!("data-mosaic-{}", hash(&src));
        let code = jsx::transform(&src, Some(&scope_attr))
            .map_err(|e| format!("{}:{e}", path.display()))?;
        let dir = path.parent().unwrap_or_else(|| Path::new("."));
        let (code, has_css) = jsx::inline_css_imports(&code, dir, Some(&scope_attr))
            .map_err(|e| format!("{}: {e}", path.display()))?;

        let mut needed = vec!["h", "Fragment"];
        if has_css {
            needed.push("addStyles");
        }
        jsx::ensure_runtime_names(&code, &args.runtime, &needed)
    } else {
        let comp = parser::parse(&src).map_err(|e| format!("{}:{e}", path.display()))?;
        let opts = codegen::Options {
            runtime: args.runtime.clone(),
            name: args.name.clone().unwrap_or_else(|| component_name(&stem)),
            hash: hash(&src),
        };
        codegen::generate(&comp, &opts)
    };

    // Line markers travel with the generated code and come out here, becoming
    // the source map's line table.
    let (js, mappings) = codegen::take_line_markers(&js);

    let name = args
        .name
        .clone()
        .unwrap_or_else(|| component_name(&stem));

    // With --bundle the modules are combined instead of written individually.
    if args.bundle.is_none() {
        let dest = match (&args.out, &args.outdir) {
            (Some(o), _) if !args.input.is_dir() => o.clone(),
            (_, Some(d)) => d.join(format!("{stem}.js")),
            _ => path.with_extension("js"),
        };
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::write(&dest, &js).map_err(|e| format!("{}: {e}", dest.display()))?;
        println!("{} -> {}", path.display(), dest.display());
    }

    Ok(bundle::Module {
        source: path.to_path_buf(),
        source_text: src,
        code: js,
        mappings,
        name,
    })
}

/// `my-widget` / `my_widget` -> `MyWidget`, so the output is a valid JS identifier.
fn component_name(stem: &str) -> String {
    let mut out = String::new();
    let mut upper = true;
    for c in stem.chars() {
        if c == '-' || c == '_' || c == ' ' || c == '.' {
            upper = true;
        } else if upper {
            out.extend(c.to_uppercase());
            upper = false;
        } else {
            out.push(c);
        }
    }
    if out.is_empty() || out.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        out.insert(0, '_');
    }
    out.retain(|c| c.is_alphanumeric() || c == '_' || c == '$');
    out
}

/// FNV-1a, rendered base36 — stable per source, short enough for an attribute.
fn hash(src: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in src.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    let digits = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    let mut n = h;
    while out.len() < 7 {
        out.push(digits[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn compile(src: &str) -> String {
        let comp = parser::parse(src).expect("parse");
        codegen::generate(
            &comp,
            &codegen::Options {
                runtime: "../src/js/runtime/mosaic.js".into(),
                name: "App".into(),
                hash: "test123".into(),
            },
        )
    }

    #[test]
    fn static_markup_becomes_h_calls() {
        let js = compile("<div styleName=\"box\">Hello</div>");
        assert!(js.contains("h(\"div\", { class: \"box\" },"), "{js}");
        assert!(js.contains("\"Hello\""), "{js}");
    }

    #[test]
    fn props_are_kept_as_initializers() {
        let js = compile("<p>hi</p>");
        assert!(js.contains("export default function App(props = {}) {"), "{js}");
    }

    #[test]
    fn style_is_scoped_and_registered() {
        let js = compile("<style>.a{color:red}</style><div styleName=\"a\"></div>");
        // The stylesheet constant is namespaced so bundled modules cannot clash.
        assert!(js.contains("const CSS_App ="), "{js}");
        assert!(js.contains("addStyles(\"test123\", CSS_App);"), "{js}");
        assert!(js.contains(".a[data-mosaic-test123]"), "{js}");
        assert!(js.contains("\"data-mosaic-test123\": \"\""), "{js}");
    }

    #[test]
    fn no_scope_attribute_without_styles() {
        let js = compile("<div></div>");
        assert!(!js.contains("data-mosaic-"), "{js}");
    }

    #[test]
    fn outlet_compiles_to_a_this_binding() {
        let js = compile("<output ib:outlet=\"value\">0</output>");
        assert!(js.contains("ref: (__el) => { this.value = __el; }"), "{js}");
        assert!(!js.contains("\"ib:outlet\""), "{js}");
    }

    #[test]
    fn action_binds_a_controller_method() {
        let js = compile("<button ib:action=\"increment\">+</button>");
        assert!(js.contains("onclick: (...__a) => this.increment(...__a)"), "{js}");
        assert!(!js.contains("\"ib:action\""), "{js}");
    }

    #[test]
    fn action_takes_an_explicit_event() {
        let js = compile("<input ib:action=\"input:onInput\">");
        assert!(js.contains("oninput: (...__a) => this.onInput(...__a)"), "{js}");
    }

    #[test]
    fn action_on_a_component_binds_its_action_prop() {
        let js = compile("<Card ib:action=\"save\"/>");
        assert!(js.contains("h(Card, { action: (...__a) => this.save(...__a) })"), "{js}");
    }

    #[test]
    fn a_named_action_on_a_component_is_prefixed() {
        let js = compile("<Card ib:action=\"select:onSelect\"/>");
        assert!(js.contains("selectAction: (...__a) => this.onSelect(...__a)"), "{js}");
    }

    #[test]
    fn action_binds_several_events() {
        let js = compile("<a ib:action=\"click:go mouseenter:hover\">x</a>");
        assert!(js.contains("onclick: (...__a) => this.go(...__a)"), "{js}");
        assert!(js.contains("onmouseenter: (...__a) => this.hover(...__a)"), "{js}");
    }

    #[test]
    fn outlet_and_action_coexist_with_attributes() {
        let js = compile("<button styleName=\"a\" ib:outlet=\"button\" ib:action=\"step\">x</button>");
        assert!(js.contains("class: \"a\""), "{js}");
        assert!(js.contains("this.button = __el"), "{js}");
        assert!(js.contains("this.step(...__a)"), "{js}");
    }

    #[test]
    fn only_the_component_declaration_uses_function() {
        // Anything nested would rebind `this` and break outlets and actions.
        let js = compile("<button ib:outlet=\"b\" ib:action=\"go\">x</button>");
        assert_eq!(js.matches("function").count(), 1, "{js}");
    }

    #[test]
    fn directives_must_be_well_formed() {
        assert!(parser::parse("<p ib:outlet={x}></p>").is_err());
        assert!(parser::parse("<p ib:outlet=\"not an ident\"></p>").is_err());
        assert!(parser::parse("<p ib:outlet=\"a\" ib:outlet=\"b\"></p>").is_err());
        assert!(parser::parse("<p ib:action=\"\"></p>").is_err());
        assert!(parser::parse("<p ib:action=\"click:a click:b\"></p>").is_err());
        assert!(parser::parse("<p ib:action=\"click:not an ident\"></p>").is_err());
    }

    #[test]
    fn outlet_and_action_names_may_not_collide() {
        // The outlet would overwrite the controller method with a DOM node.
        assert!(parser::parse("<b ib:outlet=\"go\" ib:action=\"go\">x</b>").is_err());
        assert!(parser::parse("<b ib:outlet=\"go\"><i ib:action=\"go\">x</i></b>").is_err());
    }

    #[test]
    fn outlet_names_must_be_unique() {
        assert!(parser::parse("<b ib:outlet=\"a\">x</b><i ib:outlet=\"a\">y</i>").is_err());
    }

    #[test]
    fn view_element_renders_a_div_with_style_name_as_class() {
        let js = compile("<View styleName=\"counter\"><b>x</b></View>");
        assert!(js.contains("h(\"div\", { class: \"counter\" }"), "{js}");
        assert!(!js.contains("styleName"), "{js}");
    }

    #[test]
    fn view_element_is_scoped_like_any_dom_element() {
        let js = compile("<style>.a{color:red}</style><View styleName=\"a\"></View>");
        assert!(js.contains("h(\"div\", { class: \"a\", \"data-mosaic-test123\": \"\" })"), "{js}");
    }

    #[test]
    fn view_keeps_directives_and_other_attributes() {
        let js = compile("<View styleName=\"a\" id=\"root\" ib:outlet=\"box\" ib:action=\"go\"></View>");
        assert!(js.contains("class: \"a\""), "{js}");
        assert!(js.contains("id: \"root\""), "{js}");
        assert!(js.contains("this.box = __el"), "{js}");
        assert!(js.contains("this.go(...__a)"), "{js}");
    }

    #[test]
    fn view_style_name_accepts_a_binding() {
        let js = compile("<View styleName=\"card {theme}\"></View>");
        assert!(js.contains("class: bindAttr(this, [\"card \", { path: \"theme\" }])"), "{js}");
    }

    #[test]
    fn style_name_is_the_only_way_to_set_a_class() {
        // Native tags use it too; `class` is rejected everywhere.
        let js = compile("<button styleName=\"step\">x</button>");
        assert!(js.contains("h(\"button\", { class: \"step\" }"), "{js}");
        assert!(!js.contains("styleName"), "{js}");

        assert!(parser::parse("<button class=\"step\">x</button>").is_err());
        assert!(parser::parse("<View class=\"b\"></View>").is_err());
        assert!(parser::parse("<img class=\"b\">").is_err());
    }

    #[test]
    fn components_keep_style_name_as_a_prop() {
        // A component's props are not DOM attributes, so the name stays as written.
        let js = compile("<Card styleName=\"a\"/>");
        assert!(js.contains("h(Card, { styleName: \"a\" })"), "{js}");
    }

    #[test]
    fn component_tags_emit_their_imports() {
        let js = compile("<View styleName=\"a\"><Counter limit=\"3\"/></View>");
        assert!(js.contains("import Counter from \"./Counter.js\";"), "{js}");
        assert!(js.contains("h(Counter, { limit: \"3\" })"), "{js}");
    }

    #[test]
    fn each_component_is_imported_once() {
        let js = compile("<Card/><Card/><Badge/>");
        assert_eq!(js.matches("import Card from").count(), 1, "{js}");
        assert!(js.contains("import Badge from \"./Badge.js\";"), "{js}");
        // <View> is built in and never imported.
        assert!(!js.contains("import View"), "{js}");
    }

    #[test]
    fn components_are_referenced_by_identifier() {
        let js = compile("<Card title=\"hi\"><b>x</b></Card>");
        assert!(js.contains("h(Card, { title: \"hi\" }"), "{js}");
    }

    #[test]
    fn components_do_not_get_the_parent_scope_attribute() {
        let js = compile("<style>.a{color:red}</style><Card><i>x</i></Card>");
        assert!(js.contains("h(Card, null"), "{js}");
    }

    #[test]
    fn multiple_roots_wrap_in_fragment() {
        let js = compile("<p>a</p><p>b</p>");
        assert!(js.contains("h(Fragment, null,"), "{js}");
    }

    #[test]
    fn void_elements_need_no_close() {
        let js = compile("<div><br><img src=\"x.png\"></div>");
        assert!(js.contains("h(\"br\", null)"), "{js}");
    }

    #[test]
    fn text_binding_reads_the_controller() {
        let js = compile("<output>{count}</output>");
        assert!(js.contains("bindText(this, \"count\")"), "{js}");
        assert!(js.contains("import { h, Fragment, bindText }"), "{js}");
    }

    #[test]
    fn binding_accepts_a_dotted_path() {
        let js = compile("<p>{user.name}</p>");
        assert!(js.contains("bindText(this, \"user.name\")"), "{js}");
    }

    #[test]
    fn text_binding_mixes_with_literal_text() {
        let js = compile("<p>Hello {name}!</p>");
        assert!(js.contains("\"Hello \""), "{js}");
        assert!(js.contains("bindText(this, \"name\")"), "{js}");
        assert!(js.contains("\"!\""), "{js}");
    }

    #[test]
    fn attribute_binding_becomes_a_parts_list() {
        let js = compile("<div styleName=\"item {status}\"></div>");
        assert!(js.contains("class: bindAttr(this, [\"item \", { path: \"status\" }])"), "{js}");
        assert!(js.contains("bindAttr"), "{js}");
    }

    #[test]
    fn attribute_with_no_binding_stays_a_plain_string() {
        let js = compile("<div styleName=\"item\"></div>");
        assert!(js.contains("class: \"item\""), "{js}");
        assert!(!js.contains("bindAttr"), "{js}");
    }

    #[test]
    fn binding_helpers_are_imported_only_when_used() {
        let js = compile("<p>plain</p>");
        assert!(js.contains("import { h, Fragment } from"), "{js}");
    }

    #[test]
    fn bindings_must_be_property_paths_not_expressions() {
        // The point is a binding to the controller, not an expression language.
        assert!(parser::parse("<p>{count + 1}</p>").is_err());
        assert!(parser::parse("<p>{items.filter(x => x)}</p>").is_err());
        assert!(parser::parse("<p>{}</p>").is_err());
        assert!(parser::parse("<p>{unclosed</p>").is_err());
        assert!(parser::parse("<p title={x}>x</p>").is_err());
    }

    #[test]
    fn logic_and_script_are_still_rejected() {
        assert!(parser::parse("{#if a}<p>x</p>{/if}").is_err());
        assert!(parser::parse("{#each xs as x}<p>x</p>{/each}").is_err());
        assert!(parser::parse("<script>let n = 1;</script><p>x</p>").is_err());
    }

    #[test]
    fn unclosed_tag_is_an_error() {
        assert!(parser::parse("<div><span></div>").is_err());
    }
}
