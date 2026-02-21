# Destructive Operations & Confirmation Flow

## Overview

The MCP server automatically detects destructive AWS operations and implements a user-confirmation workflow to prevent accidental data loss.

## How It Works

### Step 1: Detect & Alert
When you attempt a destructive operation (delete, remove, destroy, terminate):

```bash
aws ssm delete-parameter --name "/my/secret"
```

The server detects this and returns:
```
🔴 DESTRUCTIVE OPERATION WARNING!

Command: aws ssm delete-parameter --name "/my/secret"
Profile: prod/admin

This command appears to DELETE or DESTROY resources.
This action is IRREVERSIBLE and may cause:
  • Data loss
  • Service outages
  • Billing issues
  • Security vulnerabilities

Are you ABSOLUTELY SURE you want to proceed?
```

### Step 2: User Confirmation
The CLI (Copilot CLI) detects this response and prompts:

```
⚠️  This will DELETE the AWS SSM parameter "/my/secret"

Are you sure you want to proceed?
[Yes, proceed] [Cancel]
```

### Step 3: Execute with Confirmation
If the user confirms, the CLI calls `aws_run_command_confirmed` instead:

```bash
# The CLI automatically retries with confirmed variant
aws_run_command_confirmed --profile "prod/admin" --command "aws ssm delete-parameter --name /my/secret"
```

The `_confirmed` variant skips the safety check and executes the command.

## Examples

### Example 1: Deleting a Parameter (Simple)

**User Input:**
```bash
aws ssm delete-parameter --name "/copilot/test/hello"
```

**Server Response:**
```
🔴 DESTRUCTIVE OPERATION WARNING!
Command: aws ssm delete-parameter --name "/copilot/test/hello"
Profile: my-account/admin

This command appears to DELETE or DESTROY resources.
This action is IRREVERSIBLE...
```

**CLI Prompts User:**
```
⚠️  This will DELETE the AWS SSM parameter "/copilot/test/hello"

Are you sure you want to proceed?
[✓ Yes, proceed] [Cancel]
```

**If User Selects Yes:**
CLI calls `aws_run_command_confirmed` and the parameter is deleted.

### Example 2: Terminating EC2 Instances

Similar flow for instance termination:

```bash
aws ec2 terminate-instances --instance-ids i-1234567890abcdef0
```

Server detects "terminate" keyword and prompts user to confirm before proceeding.

## Safety Levels

The confirmation behavior depends on your configured safety level:

### Strict Mode (Default)
- ✅ Confirmation required for destructive operations
- ✅ Confirmation required for high-privilege modification commands
- Perfect for production environments

### Normal Mode
- ✅ Confirmation required for destructive operations only
- ⚠️  Modifications proceed without confirmation on standard profiles
- Good for mixed dev/prod environments

### Permissive Mode
- ⚠️  Minimal confirmations
- For isolated test environments only
- NOT recommended for production access

Change safety level:
```bash
aws_update_safety_level --level "strict"  # Default
aws_update_safety_level --level "normal"
aws_update_safety_level --level "permissive"
```

## Detected Destructive Operations

The server identifies destructive operations by keyword patterns:

```
- delete, delete-*  (e.g., delete-parameter, delete-bucket)
- remove, remove-*  (e.g., remove-tags)
- destroy, destroy-* (e.g., destroy-stack)
- terminate, terminate-* (e.g., terminate-instances)
```

## Whitelisting to Skip Confirmation

If you frequently run a specific destructive command and want to skip confirmation:

```bash
aws_whitelist_command --command "aws s3 rm s3://my-temp-bucket/*" --type exact
```

Then future runs of that exact command will skip the confirmation prompt.

**Warning:** Use whitelist carefully - it bypasses the safety check!

## Integration with CLI

The GitHub Copilot CLI automatically:
1. Detects confirmation requirements from the MCP server
2. Displays the safety warning to you
3. Prompts for explicit confirmation
4. Retries with `aws_run_command_confirmed` if you confirm

This gives you control while maintaining safety guardrails.
