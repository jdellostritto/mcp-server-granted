# MCP Granted AWS - Enhanced Security Configuration

## New Features

### 1. Flexible Profile Filtering

The MCP server supports configurable profile filtering instead of hardcoded `/ro` filtering.

#### Configuration Modes:

**Suffix Filtering** (Recommended for consistent naming)
- Filter profiles by suffix patterns (e.g., `/ro`, `/admin`, `/debug`)
- Quick and easy to configure
- Works well with organizational naming conventions

**Explicit List** (Maximum control)
- Manually select specific profiles to include
- Complete control over which profiles are available
- Best for mixed environments

### 2. Safety Levels

Protect against accidental destructive operations with three safety levels:

- **Strict (Paranoid)** - Confirms ALL destructive and modifying operations
  - Recommended for production environments
  
- **Normal** - Confirms destructive operations only
  - Balanced security and convenience
  
- **Permissive** - Minimal confirmations
  - Only for controlled test environments

### 3. Command Safety Detection

The server automatically detects and warns about:

🔴 **HIGH RISK** - Destructive operations:
- Commands containing: `delete`, `remove`, `destroy`, `terminate`
- Require explicit confirmation
- Show detailed warnings about potential impact

🟡 **MEDIUM RISK** - Modifications with elevated profiles:
- Modification commands (`create`, `update`, `modify`) using `/admin` or `/super` profiles
- Warn about potential production impact
- Require confirmation in strict mode

🟢 **LOW RISK** - Read-only operations:
- No confirmation needed
- Safe to execute

## Setup Instructions

### First-Time Setup

Run the interactive configuration:

```bash
cd ~/mcp-server-granted
node server.js --setup
```

This will guide you through:
1. Choosing profile filtering mode (suffix or explicit)
2. Selecting which profiles to include
3. Setting safety level
4. Clear security warnings about elevated permissions

### Configuration File

Settings are saved to: `~/.mcp-granted-config.json`

Example configuration:
```json
{
  "profileFilter": {
    "mode": "suffix",
    "suffixes": ["/ro", "/debug"],
    "profiles": []
  },
  "safetyLevel": "strict",
  "setupCompleted": true
}
```

### Reconfiguration

You can reconfigure at any time:

**Option 1:** Run setup again
```bash
node server.js --setup
```

**Option 2:** Use the MCP tool from Claude Desktop
```
Use the aws_reconfigure tool
```

**Option 3:** Manually edit the config file
```bash
nano ~/.mcp-granted-config.json
```

**Option 4:** Delete config and restart
```bash
rm ~/.mcp-granted-config.json
node server.js --setup
```

## New MCP Tools

### aws_view_config
View current configuration including:
- Profile filter mode and settings
- Safety level
- Active profiles list
- Warnings for elevated privilege profiles

### aws_reconfigure
Run interactive setup without restarting the server.
Note: Full effect requires server restart.

## Security Warnings

### Elevated Privilege Profiles

Profiles with elevated permissions display warnings:

- `/admin`, `/super`, `/superadmin` → ⚠️ ELEVATED
- Can modify and delete production resources
- Extra caution required

### First-Time Setup Warnings

During setup, you'll see clear warnings about:
- Data deletion risks
- Infrastructure modification impacts
- Billing cost implications
- Security vulnerability creation

## Migration from Old Version

If you're upgrading from a previous version that only supported `/ro` profiles:

1. The server will automatically use `/ro` filtering as a fallback
2. Run `node server.js --setup` to configure properly
3. Your existing whitelisted commands remain unchanged

## Examples

### Example 1: Read-only profiles only (safest)

```bash
node server.js --setup
# Choose: 1 (Suffix filtering)
# Enter suffixes: /ro
# Choose safety: 1 (Strict)
```

### Example 2: Multiple permission levels

```bash
node server.js --setup
# Choose: 1 (Suffix filtering) 
# Enter suffixes: /ro,/debug,/admin
# Choose safety: 1 (Strict)
```

### Example 3: Specific profiles only

```bash
node server.js --setup
# Choose: 2 (Explicit list)
# Select profiles: 1,3,5 (or enter names)
# Choose safety: 2 (Normal)
```

## Troubleshooting

### "Command has been BLOCKED for safety"

This means the command was flagged as potentially destructive. If you're certain:
1. Review the command carefully
2. Ensure you have backups if applicable
3. The message will show on first attempt only

### Cannot run interactive setup

If running in a non-interactive environment (like systemd):
1. Run setup manually first: `node server.js --setup`
2. Then start the server normally
3. Or manually create `~/.mcp-granted-config.json`

### Want to reset configuration

```bash
rm ~/.mcp-granted-config.json
node server.js --setup
```

## Default Behavior

Without configuration, the server falls back to:
- Mode: Suffix filtering
- Suffixes: `/ro` only
- Safety Level: Strict
- Warning displayed on startup

This ensures safe defaults while prompting for proper configuration.

## Configuring via AI Assistant

You can configure the MCP server through the AI assistant using these tools:

### View Current Configuration

```
"Show me my current AWS MCP configuration"
```

This displays:
- Profile filter mode (suffix or explicit)
- Active suffixes or profiles
- Safety level
- List of all active profiles
- Warnings for elevated permission profiles

### Update Profile Filtering

**Add admin profiles (suffix mode):**
```
"Add admin profiles to my filter"
```

The AI will call: `aws_update_profile_filter(mode: "suffix", suffixes: ["/ro", "/admin"])`

**Switch to explicit mode:**
```
"Use explicit profile mode and include dev/readonly and prod/readonly"
```

The AI will call: `aws_update_profile_filter(mode: "explicit", profiles: ["dev/readonly", "prod/readonly"])`

**⚠️  Important Security Notes:**
- Changes are applied immediately after showing warnings
- Adding elevated profiles (/ admin, /super) triggers security warnings
- Shows before/after comparison
- Lists which profiles are added/removed
- Highlights elevated permission profiles

### Update Safety Level

```
"Set my safety level to normal"
```

The AI will call: `aws_update_safety_level(level: "normal")`

**Safety Level Changes:**
- Shows current vs new level
- Explains what each level means
- Warns if lowering protection
- Critical warning for permissive mode
- Applied immediately

### Example Workflows

**Scenario: Need to modify infrastructure**
```
User: "I need to create some EC2 instances. Add admin profiles to my config."

AI: [Calls aws_update_profile_filter with /admin suffix]
    Shows warning about elevated permissions
    Lists new profiles that will be added
    Applies change

User: "Thanks. Now create an EC2 instance in dev/admin"

AI: [Executes command with safety checks]
```

**Scenario: Lock down for production work**
```
User: "I'm doing production work. Set strictest safety."

AI: [Calls aws_update_safety_level(level: "strict")]
    Confirms maximum protection enabled
```

**Scenario: View what's configured**
```
User: "What profiles am I using right now?"

AI: [Calls aws_view_config]
    Shows complete configuration
    Lists all active profiles
    Highlights any with elevated permissions
```

## Security Model

The AI can:
- ✅ View current configuration (safe)
- ✅ Show what changes would do (safe)
- ✅ Apply changes WITH clear warnings (controlled)
- ✅ Highlight security implications (protective)

The AI cannot:
- ❌ Bypass safety warnings
- ❌ Hide elevated permissions
- ❌ Make silent changes
- ❌ Override whitelist requirements

All configuration changes:
- Show before/after comparison
- Display security warnings for elevated profiles
- Are logged in the output
- Take effect immediately
- Are saved to ~/.mcp-granted-config.json

You maintain control through:
- Clear visibility of all changes
- Security warnings that can't be suppressed
- Ability to review config at any time
- Option to use CLI setup instead (`node server.js --setup`)
