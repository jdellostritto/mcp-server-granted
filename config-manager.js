import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import readline from 'readline';

const CONFIG_PATH = join(homedir(), '.mcp-granted-config.json');

// Default configuration
const DEFAULT_CONFIG = {
  profileFilter: {
    mode: 'suffix',  // 'suffix' or 'explicit'
    suffixes: ['/ro'],
    profiles: []
  },
  safetyLevel: 'strict',  // 'strict', 'normal', 'permissive'
  setupCompleted: false
};

// Destructive command patterns
const DESTRUCTIVE_PATTERNS = [
  /\b(delete|remove|destroy|terminate|drop)\b/i,
  /\bdelete-/,
  /\bterminate-/,
  /\bdestroy-/,
  /\bremove-/
];

// Modifying command patterns
const MODIFYING_PATTERNS = [
  /\b(create|update|put|modify|attach|detach|associate|disassociate)\b/i,
  /\bcreate-/,
  /\bupdate-/,
  /\bput-/,
  /\bmodify-/
];

// High-privilege profile patterns
const HIGH_PRIVILEGE_PATTERNS = [
  /\/(admin|super|superadmin)$/,
  /^(admin|super|superadmin)\//
];

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    return DEFAULT_CONFIG;
  }
  
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    // Merge with defaults to ensure all fields exist
    return {
      ...DEFAULT_CONFIG,
      ...config,
      profileFilter: {
        ...DEFAULT_CONFIG.profileFilter,
        ...config.profileFilter
      }
    };
  } catch (error) {
    console.error('Error loading config:', error.message);
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function filterProfiles(allProfiles, config) {
  const { mode, suffixes, profiles } = config.profileFilter;
  
  if (mode === 'explicit') {
    // Only include explicitly listed profiles that exist
    return profiles.filter(p => allProfiles.includes(p));
  } else {
    // Suffix mode: filter by endings
    if (!suffixes || suffixes.length === 0) {
      // No filters = include all
      return allProfiles;
    }
    return allProfiles.filter(p => 
      suffixes.some(suffix => p.endsWith(suffix))
    );
  }
}

export function assessCommandSafety(command, profile) {
  const isDestructive = DESTRUCTIVE_PATTERNS.some(pattern => pattern.test(command));
  const isModifying = MODIFYING_PATTERNS.some(pattern => pattern.test(command));
  const isHighPrivilege = HIGH_PRIVILEGE_PATTERNS.some(pattern => pattern.test(profile));
  
  if (isDestructive) {
    return {
      level: 'HIGH',
      emoji: '🔴',
      message: `DESTRUCTIVE OPERATION WARNING!\n\nCommand: ${command}\nProfile: ${profile}\n\nThis command appears to DELETE or DESTROY resources.\nThis action is IRREVERSIBLE and may cause:\n  • Data loss\n  • Service outages\n  • Billing issues\n  • Security vulnerabilities\n\nAre you ABSOLUTELY SURE you want to proceed?`,
      requireConfirmation: true
    };
  }
  
  if (isModifying && isHighPrivilege) {
    return {
      level: 'MEDIUM',
      emoji: '🟡',
      message: `ELEVATED MODIFICATION WARNING\n\nCommand: ${command}\nProfile: ${profile}\n\nYou are using an elevated privilege profile (${profile}) to modify resources.\nThis may have significant impact on:\n  • Production environments\n  • Security configurations\n  • Cost/billing\n\nProceed with caution.`,
      requireConfirmation: true
    };
  }
  
  if (isModifying) {
    return {
      level: 'LOW',
      emoji: '🟡',
      message: `Modification command detected: ${command}\nThis will create or update resources.`,
      requireConfirmation: false
    };
  }
  
  return {
    level: 'SAFE',
    emoji: '🟢',
    message: 'Read-only operation',
    requireConfirmation: false
  };
}

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function runInteractiveSetup(allProfiles) {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('🔐  MCP Granted AWS - First-Time Security Setup');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  console.log('This MCP server provides access to AWS CLI commands.');
  console.log('To ensure security, we need to configure which profiles you want to use.\n');
  
  console.log('⚠️  SECURITY NOTICE ⚠️');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('AWS profiles with elevated permissions can:');
  console.log('  🔴 DELETE production data and resources');
  console.log('  🔴 MODIFY critical infrastructure');
  console.log('  🔴 CAUSE significant billing costs');
  console.log('  🔴 CREATE security vulnerabilities\n');
  console.log('Profiles ending in:');
  console.log('  • /admin, /super, /superadmin → FULL administrative access');
  console.log('  • /debug → Elevated debugging access');
  console.log('  • /infra → Infrastructure modification access');
  console.log('  • /ro (read-only) → SAFE, cannot modify resources\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Profile filtering mode
  console.log('How would you like to filter AWS profiles?\n');
  console.log('1. Suffix filtering (e.g., only profiles ending in /ro, /admin)');
  console.log('   - Quick and easy');
  console.log('   - Recommended for consistent naming conventions\n');
  console.log('2. Explicit list (manually select specific profiles)');
  console.log('   - Complete control');
  console.log('   - Recommended for mixed environments\n');
  
  const modeChoice = await prompt('Enter choice (1 or 2): ');
  
  const config = { ...DEFAULT_CONFIG };
  
  if (modeChoice === '2') {
    // Explicit mode
    config.profileFilter.mode = 'explicit';
    console.log('\nAvailable profiles:');
    allProfiles.forEach((p, i) => {
      const warning = HIGH_PRIVILEGE_PATTERNS.some(pattern => pattern.test(p)) ? ' ⚠️  ELEVATED' : '';
      console.log(`  ${i + 1}. ${p}${warning}`);
    });
    
    console.log('\nEnter profile numbers to include (comma-separated, e.g., 1,3,5):');
    console.log('Or type profile names (comma-separated):\n');
    
    const selection = await prompt('Selection: ');
    
    if (/^\d+(,\d+)*$/.test(selection)) {
      // Numbers
      const indices = selection.split(',').map(s => parseInt(s.trim()) - 1);
      config.profileFilter.profiles = indices
        .filter(i => i >= 0 && i < allProfiles.length)
        .map(i => allProfiles[i]);
    } else {
      // Names
      config.profileFilter.profiles = selection
        .split(',')
        .map(s => s.trim())
        .filter(p => allProfiles.includes(p));
    }
    
    console.log(`\n✓ Selected ${config.profileFilter.profiles.length} profiles`);
    
  } else {
    // Suffix mode
    config.profileFilter.mode = 'suffix';
    console.log('\n🔐 IMPORTANT: Choose profile suffixes carefully!\n');
    console.log('Common suffixes:');
    console.log('  /ro        → Read-only (SAFE) ✓');
    console.log('  /debug     → Debug access (MODERATE)');
    console.log('  /infra     → Infrastructure (ELEVATED) ⚠️');
    console.log('  /admin     → Admin access (DANGEROUS) 🔴');
    console.log('  /super     → Super admin (EXTREMELY DANGEROUS) 🔴🔴\n');
    
    const suffixInput = await prompt('Enter suffixes to include (comma-separated, default: /ro): ');
    
    if (suffixInput) {
      config.profileFilter.suffixes = suffixInput
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);
    }
    
    const matching = allProfiles.filter(p => 
      config.profileFilter.suffixes.some(suffix => p.endsWith(suffix))
    );
    
    console.log(`\n✓ This will include ${matching.length} profiles matching: ${config.profileFilter.suffixes.join(', ')}`);
  }
  
  // Safety level
  console.log('\n\nChoose safety level:\n');
  console.log('1. Strict (paranoid) - Confirm ALL destructive and modifying operations');
  console.log('   Recommended for production environments\n');
  console.log('2. Normal - Confirm destructive operations only');
  console.log('   Balanced security and convenience\n');
  console.log('3. Permissive - Minimal confirmations (not recommended)');
  console.log('   Only use in controlled test environments\n');
  
  const safetyChoice = await prompt('Enter choice (1, 2, or 3, default: 1): ');
  
  if (safetyChoice === '3') {
    config.safetyLevel = 'permissive';
  } else if (safetyChoice === '2') {
    config.safetyLevel = 'normal';
  } else {
    config.safetyLevel = 'strict';
  }
  
  config.setupCompleted = true;
  saveConfig(config);
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`✓ Setup complete! Configuration saved to: ${CONFIG_PATH}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('You can reconfigure anytime by deleting this file and restarting.\n');
  
  return config;
}
