# Publishing Basic Autocorrect

The same zip goes to both stores. All listing text, reviewer notes and permission justifications are in [store/listing.md](store/listing.md); the graphics are in `store/`.

## 0. Before you start

**Put the website pages live.** Both stores link to the privacy policy, and Chrome checks it.
The pages are in the Waldgrave site repo (`the-waldgave2/pages/basicautocorrect/`: `index.js`, `privacy.js`, `terms.js`). Commit and deploy only those files:

```bash
cd ~/Documents/GitHub/the-waldgave2
```

```bash
git add pages/basicautocorrect && git commit -m "Basic Autocorrect pages" && git push && git push heroku
```

Don't use `npm run gog` for this: it runs `git add .`, which would also commit your unfinished edit to `pages/escapefromhadesirl/privacy.js`.

Then check these load:
- https://waldgrave.com/basicautocorrect
- https://waldgrave.com/basicautocorrect/privacy
- https://waldgrave.com/basicautocorrect/terms

**Run the tests and build the zips** (in this repo):

```bash
npm test && npm run test:browser && npm run test:chrome && npm run test:firefox
```

```bash
npm run test:docs
```

```bash
npm run package
```

That produces:
- `dist/basic-autocorrect-1.0.0.zip`: the extension. Upload this to **both** stores.
- `dist/basic-autocorrect-1.0.0-source.zip`: source for Mozilla's reviewers (needed because the word data is generated).

## 1. Firefox: addons.mozilla.org

1. Go to https://addons.mozilla.org/developers/ and sign in with a Mozilla account (create one if needed). Accept the Firefox Add-on Distribution Agreement the first time.
2. Click **Submit a New Add-on**.
3. **How to distribute:** choose **On this site** (listed publicly on addons.mozilla.org).
4. **Upload** `dist/basic-autocorrect-1.0.0.zip`. Automatic validation should pass with no errors or warnings (it matches `web-ext lint`).
5. **Compatibility:** check **Firefox** only. Uncheck **Firefox for Android**: it hasn't been tested there.
6. **Source code:** when asked "Do you need to submit source code?", answer **Yes** and upload `dist/basic-autocorrect-1.0.0-source.zip`.
7. **Describe your add-on** (text in `store/listing.md`):
   - Name: `Basic Autocorrect`
   - Add-on URL (slug): `basic-autocorrect`
   - Summary: the short description
   - Description: the full description
   - Categories: **Language Support**
   - Support email: `bricarlis@gmail.com`
   - Homepage: `https://waldgrave.com/basicautocorrect`
   - License: **MIT License**
   - Privacy policy: check "This add-on has a privacy policy" and paste the policy text, or the link: https://waldgrave.com/basicautocorrect/privacy
   - Notes to reviewer: the "Firefox (AMO): Notes to reviewer" section
8. Submit. After that, on the add-on's **Edit Product Page**, upload the screenshots: `store/screenshot-1-typing.png`, `store/screenshot-2-popup.png`, `store/screenshot-3-privacy.png`.
9. **Review:** the add-on is usually live within minutes to a day after automated review; a human review can follow later. You'll get email at each step.

Listing URL afterwards: https://addons.mozilla.org/firefox/addon/basic-autocorrect/

Your own Firefox: once it's live, install it from that page and remove the temporary copy in `about:debugging`. The add-on ID changed for the release (`basic-autocorrect@waldgrave.com`), so settings from the temporary copy won't carry over.

## 2. Chrome Web Store

1. Go to https://chrome.google.com/webstore/devconsole and sign in with the Google account to publish under.
   - First time only: accept the developer agreement, pay the one-time **$5** registration fee, and verify your contact email. 2-Step Verification must be on for the account.
   - Under **Account**, set the publisher name (e.g. "The Waldgrave").
2. Click **New item** and upload `dist/basic-autocorrect-1.0.0.zip`.
3. **Store listing** tab:
   - Description: the full description from `store/listing.md` (the short description comes from the manifest)
   - Category: **Productivity → Tools**
   - Language: **English**
   - Store icon: `icons/icon-128.png`
   - Screenshots: the three `store/screenshot-*.png` files (1280×800)
   - Small promo tile: `store/promo-small.png` (440×280)
   - Homepage URL: `https://waldgrave.com/basicautocorrect`
   - Support URL: `https://waldgrave.com/basicautocorrect`
4. **Privacy practices** tab: everything is in the "Chrome Web Store: Privacy practices tab" section of `store/listing.md`: single purpose, the two permission justifications, "No" for remote code, no data types checked, the three certifications, and the privacy policy URL.
5. **Distribution** tab: Visibility **Public**, all regions, free.
6. Click **Submit for review**. Extensions that run on all sites get a more careful review; expect anywhere from a day to a couple of weeks. You'll get an email.

Listing URL afterwards: shown on the item's dashboard (`https://chromewebstore.google.com/detail/<id>`).

## 3. After both are live

Update `the-waldgave2/pages/basicautocorrect/index.js`: replace "Coming soon to Firefox and Chrome" with links to the two listing URLs, then deploy the site the same way as in step 0.

## Releasing an update

1. Bump `"version"` in `manifest.json` (e.g. `1.0.1`); both stores require a higher version each time.
2. Run the tests, then `npm run package`.
3. Firefox: on the add-on's page in the developer hub, choose **Upload New Version**, then upload the new zip and source zip.
4. Chrome: on the item's page, open **Package**, choose **Upload new package**, then submit for review.

To regenerate the store graphics after a design change, run `node scripts/make-store-assets.mjs`.
