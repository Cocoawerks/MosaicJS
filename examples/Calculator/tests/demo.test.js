// A demo of the Calculator, written as a `mosaic test` script: it works the
// calculator by pressing keys and reading the answers back. By default it opens
// a window and works at a pace you can watch — a demo — and the same script run
// with `--headless` is a fast, windowless test.
//
//   mosaic test examples/Calculator --script examples/Calculator/tests/demo.test.js
//   mosaic test examples/Calculator --script examples/Calculator/tests/demo.test.js --headless
//
// A test script is an ES module whose default export is an async
// `(page, context) => {…}`. It is handed puppeteer's `page`, already at the
// application; it throws to fail and returns to pass. The pace is puppeteer's
// own (`--speed`), so this file adds no sleeps of its own.

/** Press a key by the label it reads — "7", "+", "=". */
async function press(page, label) {
  const handle = await page.evaluateHandle((want) => {
    for (const button of document.querySelectorAll(".v-Button")) {
      if (button.textContent.trim() === want) return button;
    }
    return null;
  }, label);
  const el = handle.asElement();
  if (!el) throw new Error(`no key reads "${label}"`);
  // A real click rather than `el.click()` in the page, so `--slow` can pace it
  // and a headed run shows the button being pressed.
  await el.click();
}

/** The readout's current text, trimmed. */
async function display(page) {
  return (await page.$eval(".display", (el) => el.textContent)).trim();
}

export default async (page) => {
  await page.waitForSelector(".v-Button");

  // Each line is the keys to press and the answer to expect. The minus key is
  // the Unicode minus sign "−" (U+2212), not an ASCII "-".
  const sums = [
    ["12+3=", "15"],
    ["7×8=", "56"],
    ["9−4=", "5"],
    ["6÷2=", "3"],
  ];

  for (const [keys, want] of sums) {
    await press(page, "C");
    for (const key of keys) await press(page, key);
    const got = await display(page);
    if (got !== want) throw new Error(`${keys} → "${got}", expected "${want}"`);
    console.log(`${keys} = ${got}`);
  }
};
