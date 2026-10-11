# LAMMA Desktop

The Windows app for [LAMMA](https://www.lammaonline.website), a party game you host on a TV or laptop while
everyone joins from their phone.

This is a small [Electron](https://www.electronjs.org/) shell: it opens www.lammaonline.website in its own
window, adds fullscreen/windowed modes, an offline screen and automatic updates. No game code runs from
this repository.

## Build

```
npm ci
npm start                                   # run
npx electron-builder --win nsis --x64       # installer in dist/
```

## Releases

Push a tag `vX.Y.Z` and GitHub Actions builds the installer, signs it and publishes a GitHub Release
(`LAMMA-Setup.exe` + `latest.yml`, the auto-update feed).

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

- Committers and reviewers: [Mohamed (yousefimam1-cmyk)](https://github.com/yousefimam1-cmyk)
- Approvers: [Mohamed (yousefimam1-cmyk)](https://github.com/yousefimam1-cmyk)

Only installers built by this repository's GitHub Actions from tagged commits are signed, and every
signing request is approved by hand.

## Privacy

The app itself sends nothing anywhere except loading www.lammaonline.website and checking
www.lammaonline.website/downloads/latest.yml for updates. What the website collects is described in its
[privacy policy](https://www.lammaonline.website/privacy).

## License

Code: MIT (see LICENSE). The LAMMA name, Lama mascot and icons are trademarks of Almadarek Games.
