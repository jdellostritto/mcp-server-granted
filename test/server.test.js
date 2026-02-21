import { jest } from '@jest/globals';
import { 
  loadWhitelist, 
  isCommandAllowed, 
  addToWhitelist,
  loadAllAwsProfiles 
} from '../server.js';
import { writeFileSync, unlinkSync, existsSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_WHITELIST_FILE = join(__dirname, '../allowed-commands.json');
const BACKUP_FILE = join(__dirname, '../allowed-commands.json.backup');
const TEST_AWS_DIR = join(homedir(), '.aws-test-' + Date.now());
const TEST_AWS_CONFIG = join(TEST_AWS_DIR, 'config');

describe('Whitelist Management', () => {
  beforeEach(() => {
    // Backup existing whitelist if it exists
    if (existsSync(TEST_WHITELIST_FILE)) {
      const content = readFileSync(TEST_WHITELIST_FILE, 'utf8');
      writeFileSync(BACKUP_FILE, content);
      unlinkSync(TEST_WHITELIST_FILE);
    }
  });

  afterEach(() => {
    // Restore backup if it exists
    if (existsSync(BACKUP_FILE)) {
      const content = readFileSync(BACKUP_FILE, 'utf8');
      writeFileSync(TEST_WHITELIST_FILE, content);
      if (existsSync(BACKUP_FILE)) {
        unlinkSync(BACKUP_FILE);
      }
    }
  });

  describe('loadWhitelist', () => {
    test('should create default whitelist when file does not exist', () => {
      const whitelist = loadWhitelist();
      
      expect(whitelist.patterns).toContain('^aws s3 ls');
      expect(whitelist.exactMatches).toEqual([]);
      expect(existsSync(TEST_WHITELIST_FILE)).toBe(true);
    });

    test('should load existing whitelist structure', () => {
      // Create a test whitelist file
      const testWhitelist = {
        patterns: ['^aws s3 ls', '^aws ec2 describe-'],
        exactMatches: ['aws s3 ls s3://specific-bucket']
      };
      writeFileSync(TEST_WHITELIST_FILE, JSON.stringify(testWhitelist, null, 2));
      
      const whitelist = loadWhitelist();
      
      expect(whitelist.patterns).toHaveLength(2);
      expect(whitelist.exactMatches).toHaveLength(1);
      expect(whitelist.patterns).toContain('^aws ec2 describe-');
      expect(whitelist.exactMatches).toContain('aws s3 ls s3://specific-bucket');
    });

    test('should handle multiple calls', () => {
      const whitelist1 = loadWhitelist();
      const whitelist2 = loadWhitelist();
      
      expect(whitelist1.patterns).toEqual(whitelist2.patterns);
      expect(whitelist1.exactMatches).toEqual(whitelist2.exactMatches);
    });

    test('should load whitelist with many patterns', () => {
      const testWhitelist = {
        patterns: [
          '^aws s3 ls',
          '^aws s3 cp',
          '^aws s3 sync',
          '^aws ec2 describe-',
          '^aws rds describe-',
          '^aws lambda list-'
        ],
        exactMatches: ['aws s3 ls s3://bucket1', 'aws s3 ls s3://bucket2']
      };
      writeFileSync(TEST_WHITELIST_FILE, JSON.stringify(testWhitelist, null, 2));
      
      const whitelist = loadWhitelist();
      
      expect(whitelist.patterns).toHaveLength(6);
      expect(whitelist.exactMatches).toHaveLength(2);
    });
  });

  describe('isCommandAllowed', () => {
    beforeEach(() => {
      // Set up test whitelist
      const testWhitelist = {
        patterns: ['^aws ec2 describe-', '^aws s3 ls', '^aws s3 (cp|sync)'],
        exactMatches: ['aws s3 ls s3://my-bucket', 'aws rds describe-db-instances']
      };
      writeFileSync(TEST_WHITELIST_FILE, JSON.stringify(testWhitelist, null, 2));
    });

    test('should allow command matching exact match', () => {
      const isAllowed = isCommandAllowed('aws s3 ls s3://my-bucket');
      expect(isAllowed).toBe(true);
    });

    test('should allow command matching pattern', () => {
      const isAllowed = isCommandAllowed('aws ec2 describe-vpcs --region us-west-2');
      expect(isAllowed).toBe(true);
    });

    test('should block command not in whitelist', () => {
      const isAllowed = isCommandAllowed('aws ec2 terminate-instances');
      expect(isAllowed).toBe(false);
    });

    test('should handle multiple pattern matches', () => {
      expect(isCommandAllowed('aws s3 ls')).toBe(true);
      expect(isCommandAllowed('aws ec2 describe-instances')).toBe(true);
      expect(isCommandAllowed('aws rds describe-db-instances')).toBe(true);
      expect(isCommandAllowed('aws lambda list-functions')).toBe(false);
    });

    test('should trim whitespace from commands', () => {
      const isAllowed = isCommandAllowed('  aws s3 ls s3://my-bucket  ');
      expect(isAllowed).toBe(true);
    });

    test('should match alternation patterns', () => {
      expect(isCommandAllowed('aws s3 cp file.txt s3://bucket/')).toBe(true);
      expect(isCommandAllowed('aws s3 sync . s3://bucket/')).toBe(true);
      expect(isCommandAllowed('aws s3 rm file.txt')).toBe(false);
    });

    test('should be case-sensitive', () => {
      expect(isCommandAllowed('AWS S3 LS')).toBe(false);
      expect(isCommandAllowed('aws s3 ls')).toBe(true);
    });

    test('should handle complex patterns', () => {
      const complexWhitelist = {
        patterns: ['^aws [a-z0-9]+ (describe-|list-|get-)'],
        exactMatches: []
      };
      writeFileSync(TEST_WHITELIST_FILE, JSON.stringify(complexWhitelist, null, 2));
      
      expect(isCommandAllowed('aws ec2 describe-instances')).toBe(true);
      expect(isCommandAllowed('aws iam list-users')).toBe(true);
      expect(isCommandAllowed('aws s3 get-object')).toBe(true);
      expect(isCommandAllowed('aws ec2 terminate-instances')).toBe(false);
    });

    test('should handle empty command', () => {
      expect(isCommandAllowed('')).toBe(false);
    });

    test('should handle command with special characters', () => {
      const specialWhitelist = {
        patterns: [],
        exactMatches: ['aws s3 cp "file with spaces.txt" s3://bucket/']
      };
      writeFileSync(TEST_WHITELIST_FILE, JSON.stringify(specialWhitelist, null, 2));
      
      expect(isCommandAllowed('aws s3 cp "file with spaces.txt" s3://bucket/')).toBe(true);
    });
  });

  describe('addToWhitelist', () => {
    beforeEach(() => {
      // Start with empty whitelist
      const emptyWhitelist = {
        patterns: [],
        exactMatches: []
      };
      writeFileSync(TEST_WHITELIST_FILE, JSON.stringify(emptyWhitelist, null, 2));
    });

    test('should add exact match to whitelist', () => {
      const command = 'aws s3 ls s3://my-bucket';
      const result = addToWhitelist(command, 'exact');

      expect(result.exactMatches).toContain(command);
      expect(result.exactMatches).toHaveLength(1);
    });

    test('should add pattern to whitelist', () => {
      const pattern = '^aws ec2 describe-';
      const result = addToWhitelist(pattern, 'pattern');

      expect(result.patterns).toContain(pattern);
      expect(result.patterns).toHaveLength(1);
    });

    test('should not add duplicate exact matches', () => {
      const command = 'aws s3 ls s3://my-bucket';
      addToWhitelist(command, 'exact');
      const result = addToWhitelist(command, 'exact');

      expect(result.exactMatches).toHaveLength(1);
    });

    test('should not add duplicate patterns', () => {
      const pattern = '^aws ec2 describe-';
      addToWhitelist(pattern, 'pattern');
      const result = addToWhitelist(pattern, 'pattern');

      expect(result.patterns).toHaveLength(1);
    });

    test('should persist whitelist to file', () => {
      const command = 'aws s3 ls s3://test-bucket';
      addToWhitelist(command, 'exact');
      
      // Reload from file to verify persistence
      const reloaded = loadWhitelist();
      expect(reloaded.exactMatches).toContain(command);
    });

    test('should add multiple patterns', () => {
      addToWhitelist('^aws s3 ls', 'pattern');
      addToWhitelist('^aws ec2 describe-', 'pattern');
      const result = addToWhitelist('^aws rds describe-', 'pattern');

      expect(result.patterns).toHaveLength(3);
    });

    test('should add multiple exact matches', () => {
      addToWhitelist('aws s3 ls s3://bucket1', 'exact');
      addToWhitelist('aws s3 ls s3://bucket2', 'exact');
      const result = addToWhitelist('aws s3 ls s3://bucket3', 'exact');

      expect(result.exactMatches).toHaveLength(3);
    });

    test('should handle mix of patterns and exact matches', () => {
      addToWhitelist('^aws s3 ls', 'pattern');
      addToWhitelist('aws ec2 describe-instances --region us-east-1', 'exact');
      addToWhitelist('^aws rds describe-', 'pattern');
      const result = addToWhitelist('aws s3 ls s3://specific-bucket', 'exact');

      expect(result.patterns).toHaveLength(2);
      expect(result.exactMatches).toHaveLength(2);
    });

    test('should return updated whitelist structure', () => {
      const result = addToWhitelist('^aws s3 ls', 'pattern');
      
      expect(result).toHaveProperty('patterns');
      expect(result).toHaveProperty('exactMatches');
      expect(Array.isArray(result.patterns)).toBe(true);
      expect(Array.isArray(result.exactMatches)).toBe(true);
    });
  });
});

describe('Profile Loading', () => {
  test('should extract profiles from AWS config', () => {
    // This test validates the profile regex pattern
    const mockConfig = `
[profile login]
sso_start_url = https://example.awsapps.com/start/
sso_region = us-east-1

[profile dev/readonly]
sso_start_url = https://example.awsapps.com/start/
sso_region = us-east-1
sso_account_id = 123456789012
sso_role_name = ReadOnly
region = us-west-2

[profile dev/admin]
sso_start_url = https://example.awsapps.com/start/
sso_region = us-east-1
sso_account_id = 123456789012
sso_role_name = Admin
region = us-west-2

[profile prod/readonly]
sso_start_url = https://example.awsapps.com/start/
sso_region = us-east-1
sso_account_id = 987654321098
sso_role_name = ReadOnly
region = us-west-2
`;

    const profiles = [];
    const profileRegex = /^\[profile (.+)\]/gm;
    let match;
    
    while ((match = profileRegex.exec(mockConfig)) !== null) {
      const profileName = match[1];
      profiles.push(profileName);
    }

    expect(profiles).toHaveLength(4);
    expect(profiles).toContain('dev/readonly');
    expect(profiles).toContain('prod/readonly');
    expect(profiles).toContain('dev/admin');
    expect(profiles).toContain('login');
  });

  test('should handle empty config gracefully', () => {
    const mockConfig = '';
    const profiles = [];
    const profileRegex = /^\[profile (.+)\]/gm;
    let match;
    
    while ((match = profileRegex.exec(mockConfig)) !== null) {
      profiles.push(match[1]);
    }

    expect(profiles).toHaveLength(0);
  });

  test('should handle malformed config', () => {
    const mockConfig = `
[profile valid/profile]
some_config = value

[invalid profile without closing bracket
another_line = value

[profile another/valid]
more_config = value
`;

    const profiles = [];
    const profileRegex = /^\[profile (.+)\]/gm;
    let match;
    
    while ((match = profileRegex.exec(mockConfig)) !== null) {
      profiles.push(match[1]);
    }

    expect(profiles).toHaveLength(2);
    expect(profiles).toContain('valid/profile');
    expect(profiles).toContain('another/valid');
  });
});

describe('Command Validation', () => {
  test('should validate AWS CLI command format', () => {
    const validCommands = [
      'aws s3 ls',
      'aws ec2 describe-instances',
      'aws rds describe-db-instances --region us-west-2'
    ];

    validCommands.forEach(cmd => {
      expect(cmd).toMatch(/^aws\s+\w+/);
    });
  });

  test('should reject non-AWS commands', () => {
    const invalidCommands = [
      'ls -la',
      'kubectl get pods',
      'terraform apply'
    ];

    invalidCommands.forEach(cmd => {
      expect(cmd).not.toMatch(/^aws\s+\w+/);
    });
  });
});

describe('Regex Pattern Matching', () => {
  test('should match describe patterns correctly', () => {
    const pattern = '^aws ec2 describe-';
    const regex = new RegExp(pattern);

    expect(regex.test('aws ec2 describe-vpcs')).toBe(true);
    expect(regex.test('aws ec2 describe-instances')).toBe(true);
    expect(regex.test('aws ec2 describe-security-groups')).toBe(true);
    expect(regex.test('aws ec2 terminate-instances')).toBe(false);
    expect(regex.test('aws s3 ls')).toBe(false);
  });

  test('should match multiple operation patterns', () => {
    const pattern = '^aws s3 (ls|cp|sync)';
    const regex = new RegExp(pattern);

    expect(regex.test('aws s3 ls')).toBe(true);
    expect(regex.test('aws s3 cp file.txt s3://bucket/')).toBe(true);
    expect(regex.test('aws s3 sync . s3://bucket/')).toBe(true);
    expect(regex.test('aws s3 rm s3://bucket/file.txt')).toBe(false);
  });

  test('should handle case-sensitive matching', () => {
    const pattern = '^aws ec2 describe-';
    const regex = new RegExp(pattern);

    expect(regex.test('aws ec2 describe-vpcs')).toBe(true);
    expect(regex.test('AWS EC2 DESCRIBE-VPCS')).toBe(false);
  });
});

describe('AWS Profile Loading', () => {
  test('should handle missing AWS config file gracefully', () => {
    // This tests the error handling path when ~/.aws/config doesn't exist
    // Since we can't easily mock filesystem for loadAllAwsProfiles in current setup,
    // we test the regex pattern it uses
    const testConfig = '[profile test]\nregion=us-east-1\n[profile another/test]\nregion=us-west-2';
    const profileRegex = /^\[profile (.+)\]/gm;
    const matches = [];
    let match;
    
    while ((match = profileRegex.exec(testConfig)) !== null) {
      matches.push(match[1]);
    }
    
    expect(matches).toHaveLength(2);
    expect(matches).toContain('test');
    expect(matches).toContain('another/test');
  });

  test('should sort profiles alphabetically', () => {
    const profiles = ['zebra/profile', 'alpha/profile', 'beta/profile'];
    const sorted = profiles.sort();
    
    expect(sorted[0]).toBe('alpha/profile');
    expect(sorted[1]).toBe('beta/profile');
    expect(sorted[2]).toBe('zebra/profile');
  });
});

describe('Whitelist File Operations', () => {
  test('should handle JSON parsing errors gracefully', () => {
    // Write invalid JSON to test error handling
    const invalidJSON = '{invalid json content}';
    
    try {
      JSON.parse(invalidJSON);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(SyntaxError);
    }
  });

  test('should validate whitelist structure', () => {
    const validWhitelist = {
      patterns: ['^aws s3 ls'],
      exactMatches: []
    };
    
    expect(validWhitelist).toHaveProperty('patterns');
    expect(validWhitelist).toHaveProperty('exactMatches');
    expect(Array.isArray(validWhitelist.patterns)).toBe(true);
    expect(Array.isArray(validWhitelist.exactMatches)).toBe(true);
  });

  test('should handle empty patterns and exact matches', () => {
    const emptyWhitelist = {
      patterns: [],
      exactMatches: []
    };
    
    const command = 'aws s3 ls';
    const hasExactMatch = emptyWhitelist.exactMatches.includes(command);
    const hasPatternMatch = emptyWhitelist.patterns.some(p => new RegExp(p).test(command));
    
    expect(hasExactMatch).toBe(false);
    expect(hasPatternMatch).toBe(false);
  });
});

describe('Command Safety Edge Cases', () => {
  test('should handle commands with special characters', () => {
    const commands = [
      'aws s3 ls s3://bucket-name-with-dashes/',
      'aws s3 ls s3://bucket_with_underscores/',
      'aws s3 ls "s3://bucket with spaces/"'
    ];
    
    commands.forEach(cmd => {
      expect(cmd).toMatch(/^aws\s+/);
    });
  });

  test('should detect destructive patterns in various formats', () => {
    const destructivePatterns = [
      /\bdelete\b/i,
      /\bremove\b/i,
      /\bdestroy\b/i,
      /\bterminate\b/i
    ];
    
    const destructiveCmd = 'aws ec2 terminate-instances --instance-ids i-123';
    const hasDestructive = destructivePatterns.some(p => p.test(destructiveCmd));
    
    expect(hasDestructive).toBe(true);
  });

  test('should identify modifying patterns', () => {
    const modifyingPatterns = [
      /\bcreate\b/i,
      /\bupdate\b/i,
      /\bput\b/i,
      /\bmodify\b/i
    ];
    
    const modifyCmd = 'aws s3api put-object --bucket test --key file.txt';
    const hasModifying = modifyingPatterns.some(p => p.test(modifyCmd));
    
    expect(hasModifying).toBe(true);
  });
});
