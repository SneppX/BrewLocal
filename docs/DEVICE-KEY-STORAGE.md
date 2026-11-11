# Native device private-key storage

BrewPilot Local stores device private keys only in the operating system credential store.

## Platform backends

- Windows: Windows Credential Manager.
- macOS: macOS Keychain.
- Linux: Secret Service, such as GNOME Keyring or KWallet.

Linux is configured explicitly to require the Secret Service backend. The provider's automatic backend selection can fall back to the kernel keyutils keyring, which is volatile and does not persist across reboot. BrewPilot does not accept that fallback for device identity storage.

## Security behavior

- Device identifiers are validated and hashed before being used as credential account names.
- Only Ed25519 private keys are accepted.
- The credential-store provider is opened before a key is saved or loaded.
- Provider initialization, unlock, read, write, or delete failures stop the operation.
- There is no plaintext file, environment-variable, browser-storage, or JSON fallback.
- Private key material is never included in returned status objects or logs.

The adapter exposes storePrivateKey, loadPrivateKey, and deletePrivateKey. It does not yet perform pairing automatically or start a cloud relay. On headless Linux systems without an unlocked Secret Service, pairing must remain unavailable until the user configures a supported credential store.
