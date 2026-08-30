// A test script for `mosaic test`, run against the Calculator example:
//
//     mosaic test examples/Calculator --script examples/Calculator/tests/arithmetic.test.js
//
// `mosaic test` compiles and serves the app the way `web` does, opens it in
// headless Chromium through puppeteer, and hands this module's default export
// the page — already at the application. Throwing is a failure and returning is
// a pass; the exit code is the verdict, so this is what a CI job runs.
//
// The calculator is a grid of `Button`s and a readout, with no component of its
// own: a key is pressed by clicking the button that reads it, and the answer is
// the text of `.display`. That is all this drives — press some keys, read the
// line back, and assert.

/** The readout's current text, trimmed. */
async function display(page) {
  return (await page.$eval(".display", (el) => el.textContent)).trim();
}

/**
 * Press a key by the label it reads — `"7"`, `"+"`, `"="`. The keys are `ui`
 * Buttons drawn as `.v-Button`, so this finds the one whose text is exactly the
 * label and clicks it, the way a person would.
 */
async function press(page, label) {
  const clicked = await page.evaluate((want) => {
    for (const button of document.querySelectorAll(".v-Button")) {
      if (button.textContent.trim() === want) {
        button.click();
        return true;
      }
    }
    return false;
  }, label);
  if (!clicked) throw new Error(`no key reads "${label}"`);
}

/** Press each character of `keys` in turn: `"12+3="`. */
async function type(page, keys) {
  for (const key of keys) await press(page, key);
}

/** Fail unless the readout reads `want`. */
async function expectDisplay(page, want) {
  const got = await display(page);
  if (got !== want) {
    throw new Error(`display reads "${got}", expected "${want}"`);
  }
  console.log(`ok: display reads "${want}"`);
}

export default async (page) => {
  // The page has to be there at all before any key means anything.
  await page.waitForSelector(".v-Button");

  // A fresh line to start from, whatever a previous assertion left.
  await press(page, "C");
  await expectDisplay(page, "0");

  // 12 + 3 = 15
  await type(page, "12+3=");
  await expectDisplay(page, "15");

  // 7 × 6 = 42, from a clear
  await press(page, "C");
  await type(page, "7×6=");
  await expectDisplay(page, "42");

  // Typing a number replaces the leading zero rather than appending to it.
  await press(page, "C");
  await type(page, "9");
  await expectDisplay(page, "9");
};
