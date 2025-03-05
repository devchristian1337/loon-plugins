# Loon Plugins

A collection of custom plugins for [Loon](https://apps.apple.com/app/loon/id1373567447), a powerful network tool for iOS.

## Available Plugins

| Plugin  | Description                      | Features                                                   | Link                                                                                                                                                            |
| ------- | -------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YouTube | Enhances your YouTube experience | Ad removal, PiP, subtitle translation, background playback | [Download](https://www.nsloon.com/openloon/import?plugin=https://raw.githubusercontent.com/devchristian1337/loon-plugin/refs/heads/main/Plugins/YouTube.plugin) |

### YouTube Plugin

![YouTube Icon](https://raw.githubusercontent.com/sooyaaabo/Loon/main/App-Icons/youtube-icon.png)

This plugin enhances your YouTube experience by:

- Removing ads
- Enabling Picture-in-Picture
- Supporting subtitle translation
- Supporting lyrics translation
- Enabling background playback

#### Requirements

- Loon version 3.2.6 or newer
- QUIC fallback protection
- Not supported on tvOS

#### Installation

1. Open Loon
2. Go to the "Plugin" tab
3. Tap the "+" button
4. Paste the following URL:
   ```
   https://raw.githubusercontent.com/devchristian1337/loon-plugin/refs/heads/main/YouTube.plugin
   ```
5. Tap "Download"

Alternatively, you can directly import by clicking [here](https://www.nsloon.com/openloon/import?plugin=https://raw.githubusercontent.com/devchristian1337/loon-plugin/refs/heads/main/Plugins/YouTube.plugin).

## How It Works

The plugin uses a combination of:

- URL rewriting to block ad requests
- Script injection to modify YouTube's behavior
- MitM (Man-in-the-Middle) to intercept and modify traffic

## Updates

Check back regularly for updates to existing plugins and new additions to the collection.

## Disclaimer

This plugin is for personal use only. Use at your own risk. The developer is not responsible for any issues that may arise from using these plugins.

## Author

[devchristian1337](https://github.com/devchristian1337)
