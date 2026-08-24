# SkyStream Plugins — Source (private)

Private source home for the plugin repository. On every push to `main`, the
[build workflow](.github/workflows/build.yml) bundles every plugin into `.sky`
files and publishes them to the public artifacts repo:

- Artifacts repo: `thegnsme/skyplugins` → branch `main`
- Install link for users:
  `https://raw.githubusercontent.com/thegnsme/skyplugins/main/repo.json`

## Plugins

Each folder is one plugin (`plugin.json` manifest + `plugin.js` source).

## Local build (optional)

```bash
npm install -g skystream-cli
skystream deploy -u "https://raw.githubusercontent.com/thegnsme/skyplugins/main"
```

## Player note

Plugins do not select a video player — playback always uses the app's internal
ExoPlayer (Media3) engine.
