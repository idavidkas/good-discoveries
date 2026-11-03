"""Generate a VAPID P-256 signing key for sending real Web Push notifications.

Keep the private key OUTSIDE Git and the static Pages output.
"""
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

root = Path(__file__).resolve().parents[1]
private = root / 'secrets' / 'vapid_private.pem'
private.parent.mkdir(parents=True, exist_ok=True)
if private.exists():
    raise SystemExit('VAPID key already exists: refusing to overwrite (existing users depend on it).')
key = ec.generate_private_key(ec.SECP256R1())
private.write_bytes(key.private_bytes(serialization.Encoding.PEM,
                                      serialization.PrivateFormat.TraditionalOpenSSL,
                                      serialization.NoEncryption()))
private.chmod(0o600)
print('Private VAPID key created at:', private)
print('Configure VAPID_PRIVATE_KEY_FILE=/app/secrets/vapid_private.pem')
print('Set VAPID_SUBJECT=mailto:your-real-address@example.com')
print('Never commit the PEM file or share it with a browser.')
