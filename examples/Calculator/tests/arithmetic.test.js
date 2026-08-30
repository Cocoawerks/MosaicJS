// A demo of the Calculator, written as a `mosaic test` script: it works the
// calculator by pressing keys and reading the answers back. By default it opens
// a window and works at a pace you can watch — a demo — and the same script run
// with `--headless` is a fast, windowless test.
//
//   mosaic test examples/Calculator --script examples/Calculator/tests/arithmetic.test.js
//   mosaic test examples/Calculator --script examples/Calculator/tests/arithmetic.test.js --headless
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

/** Wait `ms` milliseconds. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The readout's current text, trimmed. */
async function display(page) {
  return (await page.$eval(".display", (el) => el.textContent)).trim();
}

/** The calculator page's current background colour, as the browser resolves it. */
async function background(page) {
  return page.$eval(".calculator", (el) => getComputedStyle(el).backgroundColor);
}

/** Flip the "Dark" switch — the `.v-Switch` whose label reads Dark. */
async function toggleDark(page) {
  const handle = await page.evaluateHandle(() => {
    for (const control of document.querySelectorAll(".v-Switch")) {
      if (control.textContent.trim() === "Dark") return control;
    }
    return null;
  });
  const el = handle.asElement();
  if (!el) throw new Error("no Dark switch to flip");
  await el.click();
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

  // Finally, go dark. Flipping the switch swaps the theme's stylesheet, which
  // restyles the page — so the calculator's background is a different colour
  // after than before, and that is what says the toggle took.
  const light = await background(page);
  // A beat either side of the flip so a headed run lands on the light page,
  // switches, and rests on the dark one, rather than the change flashing past.
  await sleep(500);
  await toggleDark(page);
  await page.waitForFunction(
    (was) =>
      getComputedStyle(document.querySelector(".calculator")).backgroundColor !==
      was,
    { timeout: 2000 },
    light,
  );
  const dark = await background(page);
  console.log(`dark mode on: background ${light} → ${dark}`);
  await sleep(500);
};
