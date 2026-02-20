# MCP Server for Granted

[![CI](https://github.com/YOUR_USERNAME/mcp-server-granted/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/mcp-server-granted/actions/workflows/ci.yml)

Model Context Protocol (MCP) server for AWS multi-account access using [Granted](https://granted.dev), with automatic credential caching and command whitelisting.

> **Note:** This is an independent MCP server implementation. [Granted](https://granted.dev) is a product by [Common Fate](https://commonfate.io).

## What This Does

Provides AI assistants (GitHub Copilot, Claude, etc.) with the ability to:
- Query AWS resources across multiple accounts
- Automatically manage AWS credential caching using Granted
- Dynamically discover AWS profiles from `~/.aws/config`
- Run AWS CLI commands with security-first whitelisting
- Track and approve commands for persistent access

## Installation

### Prerequisites

- **Node.js 18+** - For the MCP server
- **AWS CLI** - For running AWS commands
- **Granted** - For AWS role assumption and credential management
  ```bash
  brew install granted
  ```
- **GitHub Copilot CLI** or compatible MCP client
- **~/.aws/config** - Must contain your AWS SSO profiles

### AWS Configuration

The server **automatically discovers profiles** from `~/.aws/config`. It will load all profiles ending in `/ro` (read-only).

**Example `~/.aws/config`:**
```ini
[profile login]
sso_start_url = https://your-org.awsapps.com/start/
sso_region = us-east-1

[profile dev/vault/ro]
sso_start_url = https://your-org.awsapps.com/start/
sso_region = us-east-1
sso_account_id = 123456789012
sso_role_name = ReadOnlyRole
region = us-west-2

[profile prod/vault/ro]
sso_start_url = https://your-org.awsapps.com/start/
sso_region = us-east-1
sso_account_id = 987654321098
sso_role_name = ReadOnlyRole
region = us-west-2
```

**Note:** Only profiles ending in `/ro` are loaded for security. This prevents accidental write operations.

### Setup

1. **Install dependencies:**
   ```bash
   cd ~/aws-access
   npm install
   ```

2. **Add to your MCP configuration:**
   
   Edit `~/.copilot/mcp-config.json` and add:
   ```json
   {
     "mcpServers": {
       "mcp-server-granted": {
         "command": "node",
         "args": ["/Users/YOUR_USERNAME/aws-access/server.js"]
       }
     }
   }
   ```
   
   **Important:** Replace `YOUR_USERNAME` with your actual username!

3. **Restart Copilot CLI** (if already running)

The server is now available as `mcp-server-granted` with tools prefixed with `aws_`.

## How It Works

### Dynamic Profile Discovery

Profiles are **loaded dynamically** from `~/.aws/config`:
- No hardcoded account IDs or profile names
- Safe to commit to version control
- Automatically picks up new profiles when added to AWS config
- Filters for read-only profiles (ending in `/ro`)

### Credential Caching

1. **First request** - Uses `granted credential-process` to assume role via SSO
2. **Caches credentials** - Stores AWS session tokens in `~/aws-access/credentials/`
3. **Validity tracking** - Credentials valid for 50 minutes
4. **Auto-refresh** - Expired credentials refreshed automatically on next use
5. **Security** - Uses temporary session tokens, never long-term keys

### Command Whitelisting

**Security-first approach:**
- All AWS commands must be whitelisted before execution
- Whitelist persists in `allowed-commands.json` (gitignored)
- First run creates file with minimal defaults: `^aws s3 ls`

**How it works:**
1. **New command** → Blocked with error message
2. **AI calls** `aws_whitelist_command` → Command added to whitelist
3. **Re-run command** → Now allowed
4. **Future sessions** → Command works immediately

**Two whitelist types:**
- **Pattern match** (regex): `^aws ec2 describe-` allows all EC2 describe commands
- **Exact match**: `aws s3 ls s3://specific-bucket` allows only that specific command

**Example flow:**
```
User: "List RDS instances in dev/vault"
  ↓
AI: Runs: aws rds describe-db-instances --region us-west-2
  ↓
Server: ❌ Command not whitelisted
  ↓
AI: Calls aws_whitelist_command("^aws rds describe-", "pattern")
  ↓
Server: ✅ Pattern added to allowed-commands.json
  ↓
AI: Re-runs: aws rds describe-db-instances --region us-west-2
  ↓
Server: ✅ Success
```

**Next time:** The command runs immediately without approval!

## Usage

Once installed, you can ask the AI assistant:

```
"List S3 buckets in dev/vault"
"Show VPCs in prod/vault"
"Count EC2 instances across all prod accounts"
"Check credential cache status"
"Refresh credentials for dev/vault/ro"
```

The MCP server provides these tools:
- `aws_run_command` - Run AWS CLI command in a specific profile
- `aws_run_across_profiles` - Run command across multiple profiles
- `aws_credential_status` - Check cached credential status
- `aws_refresh_credentials` - Refresh credentials for a profile
- `aws_list_profiles` - List available profiles (auto-discovered from ~/.aws/config)
- `aws_whitelist_command` - Add a command to the permanent whitelist
- `aws_list_whitelist` - View all whitelisted commands
- `aws_remove_from_whitelist` - Remove a command from the whitelist

## File Structure

```
~/aws-access/
├── server.js              - MCP server (Node.js) - dynamically loads profiles
├── package.json           - Node.js dependencies
├── aws-agent.sh           - AWS command wrapper - loads profiles from ~/.aws/config
├── cred-cache.sh          - Credential cache manager - loads profiles from ~/.aws/config
├── allowed-commands.json  - Dynamic whitelist (auto-created, gitignored)
├── credentials/           - Cached AWS credentials (gitignored)
├── .gitignore             - Protects credentials and whitelist
└── agent.md               - This file
```

**Safe for Git:**
- ✅ No hardcoded account IDs
- ✅ No SSO URLs in code
- ✅ No profile names in code
- ✅ No secrets or credentials
- ✅ All sensitive data in ~/.aws/config (not committed)

## Team Sharing

To share with your team:

1. **Commit to Git** - All code is safe to commit (no secrets)
2. **Each person clones** and runs `npm install`
3. **Each person configures** their own `~/.aws/config` with SSO profiles
4. **Update MCP config** with their local path
5. **Everyone maintains** their own whitelist based on their usage patterns

**What's shared:**
- ✅ MCP server code
- ✅ Bash scripts
- ✅ Dependencies (package.json)

**What's NOT shared (gitignored):**
- ❌ Credentials cache
- ❌ Whitelist file (each dev has their own)
- ❌ AWS config (each dev has their own ~/.aws/config)

## Credential Security

- Credentials are cached locally in `~/aws-access/credentials/`
- Each credential file contains AWS session tokens (not long-term keys)
- Credentials auto-expire after 50 minutes
- Uses standard AWS IAM temporary credentials via Granted

## Troubleshooting

**"Command not found" error:**
- Ensure `aws-agent.sh` and `cred-cache.sh` are executable: `chmod +x *.sh`

**"No credentials" error:**
- Run: `./cred-cache.sh get <profile>` to initialize credentials
- Or ask AI: "Refresh credentials for dev/vault/ro"

**"MCP server not found":**
- Check the path in `~/.copilot/mcp-config.json` is correct
- Restart Copilot CLI

**Profiles not showing up:**
- Ensure profiles in `~/.aws/config` end with `/ro`
- Check profile format: `[profile dev/vault/ro]`
- Restart MCP server to reload profiles

**Whitelist issues:**
- Check `allowed-commands.json` exists (auto-created on first run)
- Verify JSON format is valid
- Delete file to reset to defaults

## Example Queries

```bash
# Check what's available
"List all AWS profiles"

# Query specific account
"Show me all S3 buckets in prod/vault/ro"

# Query multiple accounts
"List VPCs across all dev accounts"

# Manage credentials
"What's the status of my AWS credentials?"
"Refresh credentials for prod/vault/ro"

# Manage whitelist
"Show me the whitelisted commands"
"Add 'aws ecs list-clusters' to the whitelist"
"Whitelist the pattern '^aws eks describe-'"
```

## Command Whitelisting

The server uses `allowed-commands.json` to control which AWS commands can be executed.

### Initial Setup

On **first run**, the server creates `allowed-commands.json` with minimal defaults:
```json
{
  "patterns": [
    "^aws s3 ls"
  ],
  "exactMatches": []
}
```

### Approving Commands

**When a command is blocked:**
```
❌ Command not whitelisted: "aws ec2 describe-vpcs --region us-west-2"

Use the aws_whitelist_command tool to approve this command for future use.
```

**AI automatically approves:**
```javascript
// Pattern match (recommended for flexibility)
aws_whitelist_command("^aws ec2 describe-", "pattern")

// Exact match (more restrictive)
aws_whitelist_command("aws ec2 describe-vpcs --region us-west-2", "exact")
```

**Result:**
```json
{
  "patterns": [
    "^aws s3 ls",
    "^aws ec2 describe-"
  ],
  "exactMatches": []
}
```

### Whitelist Strategies

**Pattern-based (recommended):**
- `^aws ec2 describe-` - All EC2 describe commands
- `^aws rds describe-` - All RDS describe commands
- `^aws s3 (ls|cp|sync)` - Multiple S3 operations

**Exact-based (restrictive):**
- `aws s3 ls s3://my-specific-bucket` - Only this bucket
- `aws ec2 describe-instances --instance-ids i-1234567890abcdef0` - Specific instance

### Managing Whitelist

**View current whitelist:**
```bash
"Show me whitelisted commands"
```

**Remove from whitelist:**
```bash
"Remove pattern '^aws ecs' from whitelist"
```

### Security Notes

- ✅ Whitelist persists across sessions (you approve once)
- ✅ Gitignored - each developer maintains their own
- ✅ Defaults to minimal permissions (only S3 ls)
- ✅ Pattern matches use regex for flexible but controlled access
- ✅ AI can request approval, but cannot bypass whitelist

The whitelist persists across all sessions - you only approve once!

## License

MIT

## Credits

- **Granted** by [Common Fate](https://commonfate.io) - AWS credential management tool
- **Model Context Protocol** by [Anthropic](https://www.anthropic.com)

## Author

**Jim Dellostritto**

## Contributing

When contributing:
- ✅ Never commit credentials or whitelist files
- ✅ Test with multiple profile configurations  
- ✅ Ensure `.gitignore` protects sensitive files
- ✅ Document any new whitelist patterns in examples
- ✅ Run tests before submitting PRs: `npm test`
- ✅ Ensure coverage remains high: `npm run test:coverage`

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

**Test Coverage:**
- Whitelist pattern matching
- Profile discovery from AWS config
- Command validation
- Regex pattern testing

## Disclaimer

This is an independent project and is not affiliated with, endorsed by, or sponsored by Common Fate or Anthropic. Granted is a trademark of Common Fate.
