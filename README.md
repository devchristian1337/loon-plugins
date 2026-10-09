<p align="center">
  <img src="https://iili.io/3FBKKaj.png" width="700" />
</p>

<h1 align="center">Loon Plugins</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-iOS-blue" alt="Platform iOS" />
  <img src="https://img.shields.io/badge/Loon-v3.2.6+-orange" alt="Loon v3.2.6+" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License MIT" />
</p>

<p align="center">A collection of ad-blocking and premium-unlocking plugins for <a href="https://apps.apple.com/app/loon/id1373567447">Loon</a>, an advanced network tool for iOS.</p>

## 📋 Table of Contents

- [Available Plugins](#available-plugins)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [How These Plugins Work](#how-these-plugins-work)
- [Troubleshooting](#troubleshooting)
- [Updates](#updates)
- [Star History](#star-history)
- [Disclaimer](#disclaimer)
- [License](#license)
- [Author](#author)

## 🔌 Available Plugins

| Plugin                                                                                                                                                                | Description                                   | Key Features                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| [Badoo AdBlock](https://www.nsloon.com/openloon/import?plugin=https://raw.githubusercontent.com/devchristian1337/loon-plugins/refs/heads/main/Plugins/Badoo.lpx)   | Blocks the advertising SDKs used by Badoo     | Banner, interstitial and video ad removal, no MITM required      |
| [Spotify](https://www.nsloon.com/openloon/import?plugin=https://raw.githubusercontent.com/devchristian1337/loon-plugins/refs/heads/main/Plugins/Spotify.lpx)       | Removes ads and unlocks some premium features | No ads, cleaner Home/Search/Now Playing, AI DJ removed           |
| [YouTube](https://www.nsloon.com/openloon/import?plugin=https://raw.githubusercontent.com/devchristian1337/loon-plugins/refs/heads/main/Plugins/YouTube.lpx)       | Removes ads from the YouTube app              | Ad removal, background playback, subtitle translation, channel blocklist |
| [SoundCloud](https://www.nsloon.com/openloon/import?plugin=https://raw.githubusercontent.com/devchristian1337/loon-plugins/refs/heads/main/Plugins/SoundCloud.lpx) | Unlocks SoundCloud Go+ features               | Premium content and features, Upgrade tab and badge removed      |

## ✨ Features

### Badoo AdBlock Plugin

- 🚫 Blocks the main mobile ad networks (AdMob, Meta Audience Network, AppLovin, Unity Ads, Vungle, InMobi, Mintegral, Pangle and others)
- 🔒 Rule-based only, no MITM or certificate required
- ✅ Facebook login keeps working

### Spotify Plugin

- 🚫 Remove playback, Home, Search and scroll advertisements
- 🧹 Hide the discovery feed on the Now Playing screen and the AI DJ entry
- ⚙️ Two alternative protobuf patches (local override or remote modification), enable only one
- ⚠️ Note: Audio quality cannot be set to "Very High"

### YouTube Plugin

- 🚫 Block ads in the feed, Shorts and player
- ⏯️ Optional background playback
- 🌍 Translate existing subtitle tracks to zh-CN or en-US
- 🙈 Hide the Home Shorts shelf
- 🚷 Manual or remote channel blocklist
- 🔍 Built-in logging tool for troubleshooting

### SoundCloud Plugin

- 🔓 Unlock SoundCloud Go+ premium features
- 🎵 Access to premium-only tracks and content
- 🧹 Removes the Upgrade tab and the "listen without ads" badge

## 📝 Requirements

- iOS device with [Loon](https://apps.apple.com/app/loon/id1373567447) installed (version 3.2.6 or newer)
- QUIC fallback protection enabled in Loon settings
- MITM enabled with a trusted certificate for Spotify, YouTube and SoundCloud
- Not supported on tvOS devices
- For Spotify: log in again after enabling the plugin

## 📲 Installation

1. Make sure you have [Loon](https://apps.apple.com/app/loon/id1373567447) installed (v3.2.6+)
2. Enable QUIC fallback protection in Loon settings
3. Click on the download link for the desired plugin:
   - [Badoo AdBlock Plugin](https://www.nsloon.com/openloon/import?plugin=https://raw.githubusercontent.com/devchristian1337/loon-plugins/refs/heads/main/Plugins/Badoo.lpx)
   - [Spotify Plugin](https://www.nsloon.com/openloon/import?plugin=https://raw.githubusercontent.com/devchristian1337/loon-plugins/refs/heads/main/Plugins/Spotify.lpx)
   - [YouTube Plugin](https://www.nsloon.com/openloon/import?plugin=https://raw.githubusercontent.com/devchristian1337/loon-plugins/refs/heads/main/Plugins/YouTube.lpx)
   - [SoundCloud Plugin](https://www.nsloon.com/openloon/import?plugin=https://raw.githubusercontent.com/devchristian1337/loon-plugins/refs/heads/main/Plugins/SoundCloud.lpx)
4. Loon will prompt you to add the plugin - confirm by tapping "Add Plugin"
5. For YouTube and Spotify, you can configure plugin settings in the Loon app
6. Restart the respective app
7. Wait a few moments for the plugin to take effect

## 🔧 How These Plugins Work

These plugins use various techniques to enhance your app experience:

- **Rule-based blocking**: Rejects connections to ad networks at the domain level
- **URL Rewriting**: Blocks ad requests and modifies network responses
- **Script Injection**: Modifies app behavior to enable premium features
- **MitM (Man-in-the-Middle)**: Intercepts and modifies traffic securely
- **Header Manipulation**: Bypasses restrictions by modifying request headers

## ❓ Troubleshooting

**Badoo AdBlock Plugin Issues:**

- If ads still appear, force-close and reopen Badoo
- Some sponsored content served from Badoo's own domains cannot be blocked without MITM

**Spotify Plugin Issues:**

- Log in again after enabling the plugin
- Enable only one of the two protobuf scripts, not both
- Restart the app and wait a few minutes for changes to take effect
- Some premium features may still be unavailable (e.g., very high audio quality)

**YouTube Plugin Issues:**

- Make sure MITM is enabled and the Loon certificate is trusted
- If ads still appear, try clearing the app cache or reinstalling YouTube
- Background playback requires enabling "Background App Refresh" for YouTube
- Use the built-in logging tool to collect diagnostics

**SoundCloud Plugin Issues:**

- Restart the app after installing the plugin
- Some region-restricted content may still be unavailable

## 🔄 Updates

Check back regularly for updates to existing plugins and new additions to the collection.

## ⭐ Star History

<a href="https://www.star-history.com/?repos=devchristian1337%2Floon-plugins&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=devchristian1337/loon-plugins&type=date&legend=top-left&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=devchristian1337/loon-plugins&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=devchristian1337/loon-plugins&type=date&legend=top-left" />
  </picture>
</a>

## ⚠️ Disclaimer

These plugins are for personal use only. Use at your own risk. The developer is not responsible for any issues that may arise from using these plugins, including but not limited to account restrictions or app functionality.

The plugins are not affiliated with Badoo, Spotify, YouTube, SoundCloud, or their parent companies in any way.

## 📄 License

MIT License

## 👨‍💻 Author

[devchristian1337](https://github.com/devchristian1337)

---

<p align="center">Made with ❤️ for the Loon community</p>
