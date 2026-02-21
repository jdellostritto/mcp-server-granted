# MCP Server for Granted

[![CI](https://github.com/jdellostritto/mcp-server-granted/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jdellostritto/mcp-server-granted/actions/workflows/ci.yml)


Model Context Protocol (MCP) server for AWS multi-account access using [Granted](https://granted.dev), with automatic credential caching, intelligent command safety detection, and security-first whitelisting.

> **Note:** This is an independent implementation. [Granted](https://granted.dev) is a product by [Common Fate](https://commonfate.io).

## Features

- 🔐 **Secure AWS Access** - Automatic credential caching with Granted
- 🎯 **Multi-Account Support** - Query resources across multiple AWS accounts simultaneously
- 🛡️ **Intelligent Safety** - Automatic detection and blocking of destructive operations
- ⚙️ **Configurable Profiles** - Suffix filtering or explicit profile selection
- 📋 **Command Whitelisting** - Security-first approach with persistent approval
- 🔍 **Dynamic Discovery** - Auto-discovers profiles from `~/.aws/config`

## Quick Start

### Prerequisites

- Node.js 18+
- AWS CLI
- [Granted](https://granted.dev)
- AWS SSO configured in `~/.aws/config` (or `%UserProfile%\.aws\config` on Windows)

#### Installing Granted

**macOS (Homebrew):**
```bash
brew tap common-fate/granted
brew install common-fate/granted/granted
```

**Windows:**
1. Download the latest Windows binary from [Granted releases](https://github.com/common-fate/granted/releases)
   - Look for `granted_x.x.x_windows_x86_64.zip` or `granted_x.x.x_windows_arm64.zip` (depending on your architecture)
2. Extract the ZIP file
3. Move `granted.exe` to `C:\Program Files\granted\`
4. Add `C:\Program Files\granted\` to your PATH:
   - Open Environment Variables: Win+X → System → Advanced system settings → Environment Variables
   - Under "System variables", select "Path" → Edit
   - Click "New" and add: `C:\Program Files\granted\`
   - Click OK and restart your terminal

> **Note:** Granted is not currently available on Chocolatey. If you'd like to see it packaged there, consider [opening an issue](https://github.com/common-fate/granted/issues) with the Granted team.

**Linux (APT):**
```bash
# Add the repository and install
sudo apt update
sudo apt install granted
```

**Linux (Manual):**
```bash
# Download, extract, and add to PATH
curl -OL https://github.com/common-fate/granted/releases/download/v0.38.0/granted_0.38.0_linux_x86_64.tar.gz
sudo tar -zxvf granted_0.38.0_linux_x86_64.tar.gz -C /usr/local/bin/
```

Verify installation: `granted -v`

### Installation

```bash
# Clone and install
cd ~/mcp-server-granted
npm install

# Configuration (choose one):
# Option 1: Interactive setup (recommended for first-time users)
node server.js --setup

# Option 2: Manual configuration
# Create ~/.mcp-granted-config.json with your preferences
# See CONFIGURATION.md for details

# Add to MCP config (~/.copilot/mcp-config.json)
{
  "mcpServers": {
    "mcp-server-granted": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/mcp-server-granted/server.js"]
    }
  }
}
```

**Windows MCP Config Example:**
```json
{
  "mcpServers": {
    "mcp-server-granted": {
      "command": "node",
      "args": ["C:\\Users\\YOUR_USERNAME\\mcp-server-granted\\server.js"]
    }
  }
}
```

### Basic Usage

Once installed, ask your AI assistant:

```
"List S3 buckets in dev/readonly"
"Show VPCs across all prod accounts"
"What's my AWS credential status?"
```

## How It Works

### Profile Discovery
Automatically loads AWS profiles from `~/.aws/config`. Configure which profiles to use:
- **Suffix filtering**: Include profiles ending in `/readonly`, `/admin`, etc.
- **Explicit list**: Manually select specific profiles

### Safety Levels
- **Strict** (default): Confirms all destructive and modifying operations
- **Normal**: Confirms destructive operations only
- **Permissive**: Minimal confirmations (test environments only)

### Command Whitelisting
Security-first approach where all AWS commands must be explicitly approved:

1. First run of `aws ec2 describe-instances` → ❌ Blocked
2. AI calls `aws_whitelist_command` → ✅ Approved
3. Subsequent runs → ✅ Allowed immediately

Whitelist persists across sessions - approve once, use forever.

### Credential Caching
- Uses Granted for AWS SSO authentication
- Caches credentials locally (50-minute validity)
- Auto-refreshes expired credentials
- Temporary session tokens (never long-term keys)

## Configuration

### Example AWS Config

```ini
[profile dev/readonly]
sso_start_url = https://your-org.awsapps.com/start/
sso_region = us-east-1
sso_account_id = 123456789012
sso_role_name = ReadOnlyRole
region = us-west-2

[profile prod/admin]
sso_start_url = https://your-org.awsapps.com/start/
sso_region = us-east-1
sso_account_id = 987654321098
sso_role_name = AdminRole
region = us-east-1
```

### Configuration Options

**Option 1: Interactive Setup (Recommended)**

```bash
node server.js --setup
```

Guides you through:
- Profile filtering mode selection
- Safety level configuration
- Security implications of elevated permissions

**Option 2: Manual Configuration**

Create `~/.mcp-granted-config.json` manually:

```json
{
  "profileFilter": {
    "mode": "suffix",
    "suffixes": ["/readonly", "/ro"],
    "profiles": []
  },
  "safetyLevel": "strict",
  "setupCompleted": true
}
```

Both options save configuration to `~/.mcp-granted-config.json`

See [CONFIGURATION.md](CONFIGURATION.md) for detailed configuration options.

## Available Tools

| Tool | Description |
|------|-------------|
| `aws_run_command` | Run AWS CLI command in specific profile |
| `aws_run_command_confirmed` | Run AWS CLI command after user confirms destructive operations |
| `aws_run_across_profiles` | Run command across multiple profiles |
| `aws_credential_status` | Check cached credential status |
| `aws_refresh_credentials` | Refresh credentials for profile(s) |
| `aws_list_profiles` | List available AWS profiles |
| `aws_whitelist_command` | Approve command for future use |
| `aws_list_whitelist` | View whitelisted commands |
| `aws_view_config` | View current configuration |
| `aws_logout` | Clear cached credentials |

## Project Structure

```
mcp-server-granted/
├── server.js                      # MCP server
├── config-manager.js              # Configuration & safety
├── test/                          # Test suite (115 tests)
├── CONFIGURATION.md               # Detailed configuration guide
├── DESTRUCTIVE_OPERATIONS.md      # Confirmation flow documentation
└── README.md                       # This file
```

## Safety Features

### Destructive Operation Detection & Confirmation
Automatically detects commands containing:
- `delete`, `remove`, `destroy`, `terminate`

**Smart Confirmation Flow:**
1. When you request a destructive operation, the MCP server detects it
2. Returns an error message with operation details
3. You can then use `aws_run_command_confirmed` to execute after reviewing
4. Or choose to cancel and avoid the operation

This prevents accidental destructive actions while allowing intentional operations.

See [DESTRUCTIVE_OPERATIONS.md](DESTRUCTIVE_OPERATIONS.md) for detailed examples and configuration.

### Elevated Profile Warnings
Profiles with admin/super permissions are flagged:
```
dev/admin      ⚠️  ELEVATED
prod/admin     ⚠️  ELEVATED
```

### Multi-tier Safety
Choose your safety level based on environment:
- Production → Strict
- Mixed → Normal
- Test/Dev → Permissive

## Team Sharing

Safe to commit to version control:
- ✅ No hardcoded credentials
- ✅ No account IDs in code
- ✅ All secrets in `~/.aws/config` (gitignored)
- ✅ Each developer has their own whitelist

## Testing

```bash
npm test                # Run all 115 tests
npm run test:coverage   # Run with coverage report
```

**Coverage**: ~18% overall, 90-95% business logic coverage
- Core functions fully tested
- Framework boilerplate excluded

See [TESTING_SUMMARY.md](TESTING_SUMMARY.md) for details.

## Troubleshooting

**Command not whitelisted:**
```
Use the aws_whitelist_command tool to approve this command
```

**Profiles not showing:**
- Run `node server.js --setup` to configure filtering
- Check `~/.mcp-granted-config.json`
- Verify `~/.aws/config` format

**Credentials expired:**
```
"Refresh credentials for dev/readonly"
```

**MCP server not found:**
- Check path in `~/.copilot/mcp-config.json`
- Restart Copilot CLI

## Documentation

- [CONFIGURATION.md](CONFIGURATION.md) - Detailed configuration guide
- [TESTING_SUMMARY.md](TESTING_SUMMARY.md) - Test coverage details

## License

MIT

## Credits

- [Granted](https://granted.dev) by [Common Fate](https://commonfate.io)
- [Model Context Protocol](https://modelcontextprotocol.io) by [Anthropic](https://www.anthropic.com)

## Disclaimer

This project was created to solve a specific problem: simplifying AWS CLI access and asset inspection across multiple accounts for the original author. It implements security controls that work for that use case but may not fit all environments.

**Use at your own risk.** This tool:
- Executes AWS CLI commands with your credentials
- Modifies AWS resources when configured to do so
- Manages sensitive credential caching
- May not meet your organization's security requirements

Always review and test the configuration in non-production environments first. Ensure your safety level and profile filtering align with your security policies.

This is an independent project and is not affiliated with, endorsed by, or sponsored by Common Fate or Anthropic.
