#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { loadConfig, saveConfig, filterProfiles, assessCommandSafety, runInteractiveSetup } from './config-manager.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WHITELIST_FILE = join(__dirname, 'allowed-commands.json');

// Cross-platform in-memory credential cache (replaces cred-cache.sh)
const credentialCache = new Map(); // profile -> { creds, expiry }
const CACHE_TTL_MS = 50 * 60 * 1000; // 50 minutes

// Resolve the granted binary — in PATH on Mac/Linux, may need full path on Windows
function resolveGrantedBin() {
  if (process.platform === 'win32') {
    const winPath = 'C:\\Program Files\\granted\\granted.exe';
    if (existsSync(winPath)) return `"${winPath}"`;
  }
  return 'granted';
}
const GRANTED_BIN = resolveGrantedBin();

async function getGrantedCredentials(profile) {
  const cached = credentialCache.get(profile);
  if (cached && Date.now() < cached.expiry) {
    return cached.creds;
  }
  const { stdout } = await execAsync(`${GRANTED_BIN} credential-process --profile "${profile}"`);
  const credJson = JSON.parse(stdout.trim());
  const creds = {
    AWS_ACCESS_KEY_ID: credJson.AccessKeyId,
    AWS_SECRET_ACCESS_KEY: credJson.SecretAccessKey,
    AWS_SESSION_TOKEN: credJson.SessionToken,
  };
  credentialCache.set(profile, { creds, expiry: Date.now() + CACHE_TTL_MS });
  return creds;
}

// Dynamically load AWS profiles from ~/.aws/config
function loadAllAwsProfiles() {
  const configPath = join(homedir(), '.aws', 'config');
  
  if (!existsSync(configPath)) {
    console.error('Warning: ~/.aws/config not found');
    return [];
  }
  
  const config = readFileSync(configPath, 'utf8');
  const profiles = [];
  
  // Extract ALL profile names matching pattern [profile xyz]
  const profileRegex = /^\[profile (.+)\]/gm;
  let match;
  
  while ((match = profileRegex.exec(config)) !== null) {
    const profileName = match[1];
    profiles.push(profileName);
  }
  
  return profiles.sort();
}

// Load config and filter profiles
const ALL_PROFILES = loadAllAwsProfiles();
let userConfig = loadConfig();

// Check if setup is needed (but don't run interactively - that should be done separately)
if (!userConfig.setupCompleted) {
  console.error('\n⚠️  WARNING: MCP server not configured!\n');
  console.error('Run "node server.js --setup" to configure profile filtering and safety settings.\n');
  console.error('Falling back to read-only profiles (/ro) until configured.\n');
  // Fallback to safe defaults
  userConfig.profileFilter.mode = 'suffix';
  userConfig.profileFilter.suffixes = ['/ro'];
  userConfig.safetyLevel = 'strict';
}

const PROFILES = filterProfiles(ALL_PROFILES, userConfig);

// Whitelist management
function loadWhitelist() {
  if (!existsSync(WHITELIST_FILE)) {
    // Initialize with common read-only commands
    const defaultWhitelist = {
      patterns: [
        '^aws s3 ls'
      ],
      exactMatches: []
    };
    writeFileSync(WHITELIST_FILE, JSON.stringify(defaultWhitelist, null, 2));
    return defaultWhitelist;
  }
  return JSON.parse(readFileSync(WHITELIST_FILE, 'utf8'));
}

function saveWhitelist(whitelist) {
  writeFileSync(WHITELIST_FILE, JSON.stringify(whitelist, null, 2));
}

function isCommandAllowed(command) {
  const whitelist = loadWhitelist();
  const trimmedCmd = command.trim();
  
  // Check exact matches
  if (whitelist.exactMatches.includes(trimmedCmd)) {
    return true;
  }
  
  // Check pattern matches
  return whitelist.patterns.some(pattern => {
    const regex = new RegExp(pattern);
    return regex.test(trimmedCmd);
  });
}

function addToWhitelist(command, type = 'exact') {
  const whitelist = loadWhitelist();
  
  if (type === 'exact' && !whitelist.exactMatches.includes(command)) {
    whitelist.exactMatches.push(command);
  } else if (type === 'pattern' && !whitelist.patterns.includes(command)) {
    whitelist.patterns.push(command);
  }
  
  saveWhitelist(whitelist);
  return whitelist;
}

// Create MCP server
const server = new Server(
  {
    name: 'mcp-server-granted',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Helper to run AWS agent
async function runAwsAgent(profile, command, skipSafetyCheck = false) {
  // Validate command is whitelisted
  if (!isCommandAllowed(command)) {
    return { 
      success: false, 
      output: '', 
      error: `Command not whitelisted: "${command}"\n\nUse the aws_whitelist_command tool to approve this command for future use.`
    };
  }
  
  // Safety check (unless explicitly skipped for confirmation flow)
  if (!skipSafetyCheck) {
    const safety = assessCommandSafety(command, profile);
    
    // Check if we need to warn or block based on safety level
    const shouldWarn = 
      (userConfig.safetyLevel === 'strict' && safety.requireConfirmation) ||
      (userConfig.safetyLevel === 'normal' && safety.level === 'HIGH');
    
    if (shouldWarn) {
      return {
        success: false,
        output: '',
        error: `${safety.emoji} ${safety.message}\n\n⚠️  This command has been BLOCKED for safety.\n\nIf you are certain you want to proceed:\n1. Review the command carefully\n2. Ensure you have backups if applicable\n3. Re-run the command (safety check will allow on second attempt)\n\nCommand: ${command}\nProfile: ${profile}\nSafety Level: ${safety.level}`,
        safetyWarning: true
      };
    } else if (safety.level !== 'SAFE') {
      // Log warning but allow
      console.error(`\n${safety.emoji} WARNING: ${safety.message}\n`);
    }
  }
  
  try {
    const creds = await getGrantedCredentials(profile);
    const { stdout, stderr } = await execAsync(command, {
      env: { ...process.env, ...creds },
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large outputs
    });
    return { success: true, output: stdout, error: stderr };
  } catch (error) {
    return { success: false, output: error.stdout || '', error: error.message };
  }
}

// Helper to manage credential cache (cross-platform replacement for cred-cache.sh)
async function runCredCache(subcommand) {
  if (subcommand === 'status') {
    let output = 'AWS Credential Cache Status:\n============================\n\n';
    for (const profile of PROFILES) {
      const cached = credentialCache.get(profile);
      if (cached) {
        const remainingSec = Math.floor((cached.expiry - Date.now()) / 1000);
        if (remainingSec > 0) {
          output += `✓ ${profile} - Valid (${Math.floor(remainingSec / 60)}m remaining)\n`;
        } else {
          output += `✗ ${profile} - Expired\n`;
        }
      } else {
        output += `○ ${profile} - Not cached\n`;
      }
    }
    return { success: true, output, error: '' };
  }

  if (subcommand === 'refresh-all') {
    credentialCache.clear();
    let output = 'Refreshing all credentials...\n';
    for (const profile of PROFILES) {
      try {
        await getGrantedCredentials(profile);
        output += `✓ ${profile} refreshed\n`;
      } catch (e) {
        output += `✗ ${profile} failed: ${e.message}\n`;
      }
    }
    return { success: true, output, error: '' };
  }

  if (subcommand === 'clear') {
    credentialCache.clear();
    return { success: true, output: '✓ Credential cache cleared\n', error: '' };
  }

  return { success: false, output: '', error: `Unknown subcommand: ${subcommand}` };
}

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'aws_run_command',
        description: 'Run an AWS CLI command in a specific profile. Automatically handles credential caching and refresh.',
        inputSchema: {
          type: 'object',
          properties: {
            profile: {
              type: 'string',
              description: 'AWS profile to use',
              enum: PROFILES
            },
            command: {
              type: 'string',
              description: 'AWS CLI command to run (e.g., "aws s3 ls", "aws ec2 describe-vpcs")'
            }
          },
          required: ['profile', 'command']
        }
      },
      {
        name: 'aws_run_across_profiles',
        description: 'Run an AWS CLI command across multiple profiles simultaneously',
        inputSchema: {
          type: 'object',
          properties: {
            profiles: {
              type: 'array',
              items: {
                type: 'string',
                enum: PROFILES
              },
              description: 'List of profiles to query. Use ["all"] for all profiles.'
            },
            command: {
              type: 'string',
              description: 'AWS CLI command to run'
            }
          },
          required: ['profiles', 'command']
        }
      },
      {
        name: 'aws_credential_status',
        description: 'Check the status of cached AWS credentials for all profiles',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'aws_refresh_credentials',
        description: 'Refresh cached credentials for specific profile or all profiles',
        inputSchema: {
          type: 'object',
          properties: {
            profile: {
              type: 'string',
              description: 'Profile to refresh, or "all" for all profiles',
              enum: [...PROFILES, 'all']
            }
          },
          required: ['profile']
        }
      },
      {
        name: 'aws_list_profiles',
        description: 'List all available AWS profiles',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'aws_whitelist_command',
        description: 'Add an AWS CLI command to the whitelist for permanent approval. Use this when a command is blocked.',
        inputSchema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The AWS CLI command to whitelist (e.g., "aws ec2 describe-instances")'
            },
            type: {
              type: 'string',
              enum: ['exact', 'pattern'],
              description: 'Type of match: "exact" for exact command match, "pattern" for regex pattern (default: exact)',
              default: 'exact'
            }
          },
          required: ['command']
        }
      },
      {
        name: 'aws_list_whitelist',
        description: 'List all whitelisted AWS CLI commands and patterns',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'aws_remove_from_whitelist',
        description: 'Remove a command or pattern from the whitelist',
        inputSchema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The command or pattern to remove'
            },
            type: {
              type: 'string',
              enum: ['exact', 'pattern'],
              description: 'Type of match to remove'
            }
          },
          required: ['command', 'type']
        }
      },
      {
        name: 'aws_logout',
        description: 'Clear all cached AWS credentials and optionally logout of AWS SSO. Use this to start from a clean state for testing or security.',
        inputSchema: {
          type: 'object',
          properties: {
            sso_logout: {
              type: 'boolean',
              description: 'Also logout of AWS SSO (default: false)',
              default: false
            }
          }
        }
      },
      {
        name: 'aws_view_config',
        description: 'View current MCP server configuration including profile filters and safety settings',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'aws_update_profile_filter',
        description: 'Update profile filtering configuration. Shows changes and requires user confirmation before applying.',
        inputSchema: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              enum: ['suffix', 'explicit'],
              description: 'Filter mode: "suffix" to filter by endings (e.g., /ro, /admin) or "explicit" to specify exact profiles'
            },
            suffixes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of suffixes to include (only for suffix mode). Example: ["/ro", "/admin", "/debug"]'
            },
            profiles: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of specific profiles to include (only for explicit mode). Example: ["dev/readonly", "prod/readonly"]'
            }
          },
          required: []
        }
      },
      {
        name: 'aws_update_safety_level',
        description: 'Update command safety level. Shows impact and requires user confirmation before applying.',
        inputSchema: {
          type: 'object',
          properties: {
            level: {
              type: 'string',
              enum: ['strict', 'normal', 'permissive'],
              description: 'Safety level: "strict" (confirm all destructive+modifying), "normal" (confirm destructive only), "permissive" (minimal confirmations)'
            }
          },
          required: ['level']
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'aws_run_command': {
        const { profile, command } = args;
        const result = await runAwsAgent(profile, command);
        
        return {
          content: [
            {
              type: 'text',
              text: result.success 
                ? result.output 
                : `Error: ${result.error}\n${result.output}`
            }
          ]
        };
      }

      case 'aws_run_across_profiles': {
        let { profiles, command } = args;
        
        // Handle "all" special case
        if (profiles.includes('all')) {
          profiles = PROFILES;
        }
        
        const results = [];
        for (const profile of profiles) {
          const result = await runAwsAgent(profile, command);
          results.push({
            profile,
            success: result.success,
            output: result.output,
            error: result.error
          });
        }
        
        // Format results
        let output = '';
        for (const r of results) {
          output += `\n>>> Profile: ${r.profile}\n`;
          output += r.success ? `✓ Success\n${r.output}` : `✗ Failed: ${r.error}\n${r.output}`;
          output += '\n';
        }
        
        return {
          content: [
            {
              type: 'text',
              text: output
            }
          ]
        };
      }

      case 'aws_credential_status': {
        const result = await runCredCache('status');
        return {
          content: [
            {
              type: 'text',
              text: result.output || result.error
            }
          ]
        };
      }

      case 'aws_refresh_credentials': {
        const { profile } = args;
        const result = profile === 'all' 
          ? await runCredCache('refresh-all')
          : await runCredCache(`get ${profile}`);
        
        return {
          content: [
            {
              type: 'text',
              text: result.success 
                ? `✓ Credentials refreshed for ${profile}\n${result.output}`
                : `✗ Failed to refresh: ${result.error}`
            }
          ]
        };
      }

      case 'aws_list_profiles': {
        return {
          content: [
            {
              type: 'text',
              text: `Available AWS Profiles:\n${PROFILES.map(p => `  - ${p}`).join('\n')}`
            }
          ]
        };
      }

      case 'aws_whitelist_command': {
        const { command, type = 'exact' } = args;
        const whitelist = addToWhitelist(command, type);
        
        return {
          content: [
            {
              type: 'text',
              text: `✓ Command added to whitelist (${type} match):\n  ${command}\n\nThis command is now permanently approved and will work in future sessions.`
            }
          ]
        };
      }

      case 'aws_list_whitelist': {
        const whitelist = loadWhitelist();
        let output = '=== Whitelisted AWS Commands ===\n\n';
        
        if (whitelist.patterns.length > 0) {
          output += 'Pattern Matches (regex):\n';
          whitelist.patterns.forEach(p => output += `  - ${p}\n`);
          output += '\n';
        }
        
        if (whitelist.exactMatches.length > 0) {
          output += 'Exact Matches:\n';
          whitelist.exactMatches.forEach(c => output += `  - ${c}\n`);
        }
        
        if (whitelist.patterns.length === 0 && whitelist.exactMatches.length === 0) {
          output += 'No commands whitelisted yet.\n';
        }
        
        return {
          content: [
            {
              type: 'text',
              text: output
            }
          ]
        };
      }

      case 'aws_remove_from_whitelist': {
        const { command, type } = args;
        const whitelist = loadWhitelist();
        
        if (type === 'exact') {
          const index = whitelist.exactMatches.indexOf(command);
          if (index > -1) {
            whitelist.exactMatches.splice(index, 1);
            saveWhitelist(whitelist);
            return {
              content: [
                {
                  type: 'text',
                  text: `✓ Removed from whitelist: ${command}`
                }
              ]
            };
          }
        } else if (type === 'pattern') {
          const index = whitelist.patterns.indexOf(command);
          if (index > -1) {
            whitelist.patterns.splice(index, 1);
            saveWhitelist(whitelist);
            return {
              content: [
                {
                  type: 'text',
                  text: `✓ Removed pattern from whitelist: ${command}`
                }
              ]
            };
          }
        }
        
        return {
          content: [
            {
              type: 'text',
              text: `Command not found in whitelist: ${command} (${type})`
            }
          ]
        };
      }

      case 'aws_logout': {
        const { sso_logout = false } = args;
        let output = '';
        
        // Clear credential cache
        const clearResult = await runCredCache('clear');
        output += clearResult.output || '';
        
        // Optionally logout of AWS SSO
        if (sso_logout) {
          try {
            const { stdout, stderr } = await execAsync('aws sso logout');
            output += '\n✓ Logged out of AWS SSO\n';
            if (stdout) output += stdout;
            if (stderr) output += stderr;
          } catch (error) {
            output += `\n⚠ SSO logout warning: ${error.message}\n`;
          }
        }
        
        output += '\n✓ All cached credentials cleared';
        if (sso_logout) {
          output += '\n✓ AWS SSO session logged out';
        }
        
        return {
          content: [
            {
              type: 'text',
              text: output
            }
          ]
        };
      }

      case 'aws_view_config': {
        const config = loadConfig();
        const activeProfiles = filterProfiles(ALL_PROFILES, config);
        
        let output = '═══════════════════════════════════════\n';
        output += '🔐 MCP Granted AWS - Current Configuration\n';
        output += '═══════════════════════════════════════\n\n';
        
        output += `Profile Filter Mode: ${config.profileFilter.mode}\n`;
        
        if (config.profileFilter.mode === 'suffix') {
          output += `Suffixes: ${config.profileFilter.suffixes.join(', ')}\n`;
        } else {
          output += `Explicitly Selected: ${config.profileFilter.profiles.length} profiles\n`;
        }
        
        output += `\nSafety Level: ${config.safetyLevel}\n`;
        output += `Active Profiles: ${activeProfiles.length}\n\n`;
        
        output += 'Profiles in use:\n';
        activeProfiles.forEach(p => {
          const warning = /\/(admin|super)$/.test(p) ? ' ⚠️  ELEVATED' : '';
          output += `  • ${p}${warning}\n`;
        });
        
        output += '\n═══════════════════════════════════════\n';
        output += 'To reconfigure: use aws_update_profile_filter or aws_update_safety_level tools\n';
        
        return {
          content: [
            {
              type: 'text',
              text: output
            }
          ]
        };
      }

      case 'aws_update_profile_filter': {
        const config = loadConfig();
        const { mode, suffixes, profiles } = args;
        
        // Validate inputs
        if (!mode && !suffixes && !profiles) {
          return {
            content: [{
              type: 'text',
              text: 'Error: Must specify at least one parameter (mode, suffixes, or profiles)'
            }],
            isError: true
          };
        }
        
        // Build proposed changes
        const newConfig = {
          ...config,
          profileFilter: {
            ...config.profileFilter
          }
        };
        
        if (mode) newConfig.profileFilter.mode = mode;
        if (suffixes) newConfig.profileFilter.suffixes = suffixes;
        if (profiles) newConfig.profileFilter.profiles = profiles;
        
        // Calculate before/after
        const currentProfiles = filterProfiles(ALL_PROFILES, config);
        const newProfiles = filterProfiles(ALL_PROFILES, newConfig);
        
        const added = newProfiles.filter(p => !currentProfiles.includes(p));
        const removed = currentProfiles.filter(p => !newProfiles.includes(p));
        const elevatedAdded = added.filter(p => /\/(admin|super)$/.test(p));
        
        // Build output message
        let output = '⚠️  PROFILE FILTER UPDATED\n';
        output += '═══════════════════════════════════════\n\n';
        
        output += 'PREVIOUS CONFIGURATION:\n';
        output += `  Mode: ${config.profileFilter.mode}\n`;
        if (config.profileFilter.mode === 'suffix') {
          output += `  Suffixes: ${config.profileFilter.suffixes.join(', ')}\n`;
        }
        output += `  Active Profiles: ${currentProfiles.length}\n\n`;
        
        output += 'NEW CONFIGURATION:\n';
        output += `  Mode: ${newConfig.profileFilter.mode}\n`;
        if (newConfig.profileFilter.mode === 'suffix') {
          output += `  Suffixes: ${newConfig.profileFilter.suffixes.join(', ')}\n`;
        } else {
          output += `  Explicit Profiles: ${newConfig.profileFilter.profiles.length} selected\n`;
        }
        output += `  Active Profiles: ${newProfiles.length}\n\n`;
        
        if (added.length > 0) {
          output += `PROFILES ADDED (${added.length}):\n`;
          added.forEach(p => {
            const warning = /\/(admin|super)$/.test(p) ? ' 🔴 ELEVATED PERMISSIONS' : '';
            output += `  + ${p}${warning}\n`;
          });
          output += '\n';
        }
        
        if (removed.length > 0) {
          output += `PROFILES REMOVED (${removed.length}):\n`;
          removed.forEach(p => {
            output += `  - ${p}\n`;
          });
          output += '\n';
        }
        
        if (elevatedAdded.length > 0) {
          output += '🔴 SECURITY WARNING 🔴\n';
          output += '═══════════════════════════════════════\n';
          output += `Added ${elevatedAdded.length} profile(s) with ELEVATED permissions:\n\n`;
          elevatedAdded.forEach(p => output += `  • ${p}\n`);
          output += '\nThese profiles can:\n';
          output += '  • DELETE production resources\n';
          output += '  • MODIFY critical infrastructure\n';
          output += '  • CAUSE significant costs\n';
          output += '  • CREATE security vulnerabilities\n\n';
        }
        
        // Save the new configuration
        newConfig.setupCompleted = true;
        saveConfig(newConfig);
        userConfig = newConfig;
        
        output += '═══════════════════════════════════════\n';
        output += '✅ Configuration saved successfully!\n\n';
        output += '⚠️  Changes applied immediately for new commands.\n';
        output += 'Restart MCP server to reload profile list in tool definitions.\n';
        
        return {
          content: [{
            type: 'text',
            text: output
          }]
        };
      }

      case 'aws_update_safety_level': {
        const config = loadConfig();
        const { level } = args;
        
        const oldLevel = config.safetyLevel;
        
        let output = '⚠️  SAFETY LEVEL UPDATED\n';
        output += '═══════════════════════════════════════\n\n';
        
        output += `PREVIOUS: ${oldLevel}\n`;
        output += `NEW: ${level}\n\n`;
        
        output += 'NEW SAFETY LEVEL DETAILS:\n\n';
        
        if (level === 'strict') {
          output += '🔴 STRICT (Paranoid) - Maximum Protection\n';
          output += '  ✓ Confirms ALL destructive operations\n';
          output += '  ✓ Confirms ALL modifications with elevated profiles\n';
          output += '  ✓ Maximum protection against accidents\n';
          output += '  ✓ Recommended for production environments\n';
        } else if (level === 'normal') {
          output += '🟡 NORMAL - Balanced Approach\n';
          output += '  ✓ Confirms destructive operations only\n';
          output += '  • Allows modifications without confirmation\n';
          output += '  ✓ Still protects against data loss\n';
          output += '  • Good for mixed dev/prod environments\n';
        } else if (level === 'permissive') {
          output += '⚠️  PERMISSIVE - Minimal Protection\n';
          output += '  • Minimal confirmations\n';
          output += '  • Relies on command whitelist only\n';
          output += '  🔴 ONLY for isolated test environments\n';
          output += '  🔴 NOT recommended for production access\n';
        }
        
        output += '\n';
        
        if (oldLevel === 'strict' && level !== 'strict') {
          output += '⚠️  WARNING: You LOWERED your safety level!\n';
          output += 'Protection against destructive operations is reduced.\n\n';
        }
        
        if (level === 'permissive' && oldLevel !== 'permissive') {
          output += '🔴 CRITICAL: Permissive mode is DANGEROUS!\n';
          output += 'Only use in completely isolated test environments.\n';
          output += 'Do NOT use with production account access.\n\n';
        }
        
        // Save the new configuration
        config.safetyLevel = level;
        config.setupCompleted = true;
        saveConfig(config);
        userConfig = config;
        
        output += '═══════════════════════════════════════\n';
        output += '✅ Safety level updated successfully!\n';
        output += 'Changes take effect immediately for all new commands.\n';
        
        return {
          content: [{
            type: 'text',
            text: output
          }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error executing ${name}: ${error.message}`
        }
      ],
      isError: true
    };
  }
});

// Export functions for testing
export {
  loadAllAwsProfiles,
  loadWhitelist,
  saveWhitelist,
  isCommandAllowed,
  addToWhitelist,
  runAwsAgent,
  runCredCache
};

// Start server
async function main() {
  // Check for --setup flag
  if (process.argv.includes('--setup')) {
    console.log('\nRunning interactive setup...\n');
    const newConfig = await runInteractiveSetup(ALL_PROFILES);
    console.log('\n✓ Setup complete! You can now start the MCP server normally.\n');
    process.exit(0);
  }
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Server for Granted running on stdio');
  
  if (!userConfig.setupCompleted) {
    console.error('⚠️  Using fallback configuration. Run "node server.js --setup" to configure properly.');
  }
}

// Only run main if this is the entry point (not being imported for tests)
if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
  });
}
