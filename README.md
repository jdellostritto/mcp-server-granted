# MCP Server for Granted

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
- [Granted](https://granted.dev): `brew install granted`
- AWS SSO configured in `~/.aws/config`

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
├── server.js              # MCP server
├── config-manager.js      # Configuration & safety
├── aws-agent.sh           # AWS command wrapper
├── cred-cache.sh          # Credential cache manager
├── test/                  # Test suite (115 tests)
├── CONFIGURATION.md       # Detailed configuration guide
└── TESTING_SUMMARY.md     # Test coverage details
```

## Safety Features

### Destructive Operation Detection
Automatically detects and blocks commands containing:
- `delete`, `remove`, `destroy`, `terminate`
- Requires explicit confirmation before allowing

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
