#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WHITELIST_FILE = join(__dirname, 'allowed-commands.json');

// Dynamically load AWS profiles from ~/.aws/config
function loadAwsProfiles() {
  const configPath = join(homedir(), '.aws', 'config');
  
  if (!existsSync(configPath)) {
    console.error('Warning: ~/.aws/config not found');
    return [];
  }
  
  const config = readFileSync(configPath, 'utf8');
  const profiles = [];
  
  // Extract profile names matching pattern [profile xyz]
  const profileRegex = /^\[profile (.+)\]/gm;
  let match;
  
  while ((match = profileRegex.exec(config)) !== null) {
    const profileName = match[1];
    // Only include read-only profiles (ending in /ro)
    if (profileName.endsWith('/ro')) {
      profiles.push(profileName);
    }
  }
  
  return profiles.sort();
}

const PROFILES = loadAwsProfiles();

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
async function runAwsAgent(profile, command) {
  // Validate command is whitelisted
  if (!isCommandAllowed(command)) {
    return { 
      success: false, 
      output: '', 
      error: `Command not whitelisted: "${command}"\n\nUse the aws_whitelist_command tool to approve this command for future use.`
    };
  }
  
  const agentPath = join(__dirname, 'aws-agent.sh');
  const fullCommand = `${agentPath} ${profile} "${command}"`;
  
  try {
    const { stdout, stderr } = await execAsync(fullCommand, {
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large outputs
    });
    return { success: true, output: stdout, error: stderr };
  } catch (error) {
    return { success: false, output: error.stdout || '', error: error.message };
  }
}

// Helper to run credential cache commands
async function runCredCache(command) {
  const cachePath = join(__dirname, 'cred-cache.sh');
  const fullCommand = `${cachePath} ${command}`;
  
  try {
    const { stdout, stderr } = await execAsync(fullCommand);
    return { success: true, output: stdout, error: stderr };
  } catch (error) {
    return { success: false, output: error.stdout || '', error: error.message };
  }
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

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Server for Granted running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
