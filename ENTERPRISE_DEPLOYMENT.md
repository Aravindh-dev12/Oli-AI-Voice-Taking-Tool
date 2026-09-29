# Oli Enterprise Deployment Guide

Production-grade deployment of Oli across corporate fleets requires zero-touch MDM orchestration with pre-authorized OS permissions and locked-down compliance policies.

## macOS Enterprise Deployment (Jamf Pro / Kandji)

### 1. Privacy Preferences Policy Control (PPPC Profile)

MDM administrators push a `.mobileconfig` profile authorizing Oli to access:
- **Screen Capture Kit**: System audio loopback capture
- **Microphone**: Local voice recording
- **Calendar**: Meeting context extraction

**Profile Distribution**:
```bash
# Via Jamf Pro
# 1. Settings > Configuration Profiles > New
# 2. Select "Restrictions"
# 3. Upload PPPC profile (see templates/pppc_profile.mobileconfig)
# 4. Scope to device groups requiring Oli
```

### 2. Silent PKG Installer

```bash
# Build signed enterprise PKG
./scripts/package_macos.sh

# Jamf deployment:
# 1. Computer > Policies > New
# 2. Select "Package" trigger
# 3. Upload dist/Oli-Enterprise-1.0.0.pkg
# 4. Set to run as root, install at /Applications
```

## Windows Enterprise Deployment (Microsoft Intune)

### 1. MSI Installation via Group Policy

```powershell
# Deploy via Intune or Group Policy
msiexec /i OliSetup.msi /qn ALLUSERS=1 ENFORCED_ZERO_EGRESS=1
```

### 2. Locked Enterprise Policy

Place `config/enterprise_policy.json` at:
- **macOS**: `/Library/Application Support/Oli/policy.json`
- **Windows**: `C:\Program Files\Oli\enterprise_policy.json`

The policy file is read-only and enforces:
- Zero cloud egress (no external network sockets)
- Telemetry disabled
- Local-only knowledge vault roots
- Cryptographic attestation signing

## Zero-Egress Compliance Verification

After deployment, enterprise InfoSec can verify zero data leakage:

```bash
# 1. Check network socket counter (session_manifest.json)
# 2. Verify Ed25519 signature on attestation log
# 3. Audit local SQLite transaction log

# Example attestation verification:
verifier_public_key=$(jq -r '.verifier_public_key_hex' session_manifest.json)
signature=$(jq -r '.signature_hex' session_manifest.json)
payload=$(jq -r '.session_id + .started_at_epoch + ...' session_manifest.json)

# Verify signature: ed25519_verify(verifier_public_key, payload, signature)
```

## Federated Knowledge Vault Configuration

Each fleet member can configure local knowledge roots:

```json
{
  "allowed_vector_vault_roots": [
    "~/Documents/OliVault",
    "C:\\Users\\*\\Documents\\EnterpriseVault",
    "/Volumes/Corporate/SharedBattlecards"
  ]
}
```

Knowledge is indexed locally on first run, with incremental SHA-256-based sync on changes.

## MDM Compliance Dashboard

Track Oli deployment health:
- Device enrollment status
- Policy compliance (zero-egress attestation pass rate)
- Model version distribution
- Incident reporting (crash logs, permission denials)

## Support & Updates

- **Auto-updates**: Tauri auto-updater with code-signing verification
- **Rollback**: Jamf can revert to previous versions
- **Audit logs**: All session manifests retained locally for 90 days
