# Local device identity and challenge signing

BrewPilot Local generates an Ed25519 device key pair and signs the exact challenge payload accepted by the cloud service.

## Protocol

The UTF-8 payload contains exactly five lines:

1. `BrewPilot Device Challenge v1`
2. Authenticated account ID
3. Paired device ID
4. Challenge UUID
5. Lowercase SHA-256 hex digest of the server nonce

The signature is Ed25519 and is encoded as unpadded base64url. The cloud service verifies it against the public key registered during pairing and consumes each challenge once.

## Key handling boundary

`generateDeviceKeyPair()` currently returns PEM material to its caller so the caller can hand the private key directly to a native secure-storage adapter. The helper does not write private keys to disk, log them, or provide an insecure fallback. Do not persist `privateKeyPem` in ordinary configuration, JSON, environment files, browser storage, or repository files.

The platform key-store adapters are a separate implementation milestone:
- Windows: DPAPI-backed Credential Manager storage
- macOS: Keychain
- Linux: Secret Service or KWallet

If the native key store is unavailable or locked, identity creation and signing must fail closed. Do not downgrade to plaintext storage.

## Scope

This module supplies local Ed25519 identity generation, protocol-compatible payload construction, signing, and public-key fingerprinting. It is not yet wired into the MCP pairing transport or an outbound cloud relay.
