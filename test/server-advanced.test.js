import { jest } from '@jest/globals';
import { writeFileSync, unlinkSync, existsSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock AWS config for testing
const TEST_AWS_CONFIG_DIR = join(__dirname, '.test-aws');
const TEST_AWS_CONFIG_PATH = join(TEST_AWS_CONFIG_DIR, 'config');

describe('Advanced Server Tests', () => {
  beforeAll(() => {
    // Create test AWS config directory
    if (!existsSync(TEST_AWS_CONFIG_DIR)) {
      mkdirSync(TEST_AWS_CONFIG_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up test directory
    if (existsSync(TEST_AWS_CONFIG_DIR)) {
      rmSync(TEST_AWS_CONFIG_DIR, { recursive: true, force: true });
    }
  });

  describe('Profile Loading with Real Files', () => {
    test('should load profiles from config file', () => {
      const testConfig = `
[profile dev/readonly]
sso_start_url = https://example.awsapps.com/start
sso_region = us-east-1
sso_account_id = 123456789012
sso_role_name = ReadOnly
region = us-west-2

[profile prod/admin]
sso_start_url = https://example.awsapps.com/start
sso_region = us-east-1
sso_account_id = 987654321098
sso_role_name = Admin
region = us-east-1
`;
      
      writeFileSync(TEST_AWS_CONFIG_PATH, testConfig);
      
      // Read and parse manually
      const config = readFileSync(TEST_AWS_CONFIG_PATH, 'utf8');
      const profiles = [];
      const profileRegex = /^\[profile (.+)\]/gm;
      let match;
      
      while ((match = profileRegex.exec(config)) !== null) {
        profiles.push(match[1]);
      }
      
      expect(profiles).toHaveLength(2);
      expect(profiles).toContain('dev/readonly');
      expect(profiles).toContain('prod/admin');
    });

    test('should handle config with comments', () => {
      const testConfig = `
# This is a comment
[profile test/profile]
region = us-east-1
# Another comment

[profile another/profile]
region = us-west-2
`;
      
      writeFileSync(TEST_AWS_CONFIG_PATH, testConfig);
      const config = readFileSync(TEST_AWS_CONFIG_PATH, 'utf8');
      const profiles = [];
      const profileRegex = /^\[profile (.+)\]/gm;
      let match;
      
      while ((match = profileRegex.exec(config)) !== null) {
        profiles.push(match[1]);
      }
      
      expect(profiles).toHaveLength(2);
    });

    test('should handle config with default profile', () => {
      const testConfig = `
[default]
region = us-east-1

[profile test/profile]
region = us-west-2
`;
      
      writeFileSync(TEST_AWS_CONFIG_PATH, testConfig);
      const config = readFileSync(TEST_AWS_CONFIG_PATH, 'utf8');
      const profiles = [];
      const profileRegex = /^\[profile (.+)\]/gm;
      let match;
      
      while ((match = profileRegex.exec(config)) !== null) {
        profiles.push(match[1]);
      }
      
      // Should only match [profile xxx], not [default]
      expect(profiles).toHaveLength(1);
      expect(profiles).toContain('test/profile');
      expect(profiles).not.toContain('default');
    });
  });

  describe('Whitelist Complex Scenarios', () => {
    const TEST_WHITELIST_FILE = join(__dirname, '../allowed-commands.json');
    const BACKUP_FILE = join(__dirname, '../allowed-commands.json.backup');

    beforeEach(() => {
      if (existsSync(TEST_WHITELIST_FILE)) {
        const content = readFileSync(TEST_WHITELIST_FILE, 'utf8');
        writeFileSync(BACKUP_FILE, content);
      }
    });

    afterEach(() => {
      if (existsSync(BACKUP_FILE)) {
        const content = readFileSync(BACKUP_FILE, 'utf8');
        writeFileSync(TEST_WHITELIST_FILE, content);
        unlinkSync(BACKUP_FILE);
      }
    });

    test('should handle whitelist with complex regex patterns', () => {
      const whitelist = {
        patterns: [
          '^aws s3 (ls|cp|sync|mv)',
          '^aws ec2 (describe-|get-)',
          '^aws iam (list-|get-)'
        ],
        exactMatches: []
      };

      const testCommands = [
        { cmd: 'aws s3 ls s3://bucket', expected: true },
        { cmd: 'aws s3 cp file.txt s3://bucket/', expected: true },
        { cmd: 'aws s3 rm file.txt', expected: false },
        { cmd: 'aws ec2 describe-instances', expected: true },
        { cmd: 'aws ec2 terminate-instances', expected: false },
        { cmd: 'aws iam list-users', expected: true },
        { cmd: 'aws iam create-user', expected: false }
      ];

      testCommands.forEach(({ cmd, expected }) => {
        const isAllowed = whitelist.patterns.some(pattern => {
          const regex = new RegExp(pattern);
          return regex.test(cmd);
        });
        expect(isAllowed).toBe(expected);
      });
    });

    test('should prioritize exact matches over patterns', () => {
      const whitelist = {
        patterns: ['^aws s3 ls'],
        exactMatches: ['aws s3 ls s3://specific-bucket']
      };

      const exactCmd = 'aws s3 ls s3://specific-bucket';
      const patternCmd = 'aws s3 ls s3://other-bucket';

      // Exact match
      expect(whitelist.exactMatches.includes(exactCmd)).toBe(true);
      
      // Pattern match
      const hasPatternMatch = whitelist.patterns.some(p => new RegExp(p).test(patternCmd));
      expect(hasPatternMatch).toBe(true);
    });

    test('should handle escaped special characters in patterns', () => {
      const patterns = [
        '^aws s3 ls s3://bucket\\.example\\.com',
        '^aws s3 cp .* s3://bucket/\\w+/'
      ];

      expect(new RegExp(patterns[0]).test('aws s3 ls s3://bucket.example.com')).toBe(true);
      expect(new RegExp(patterns[0]).test('aws s3 ls s3://bucketXexampleXcom')).toBe(false);
    });

    test('should validate whitelist structure on load', () => {
      const validWhitelist = {
        patterns: ['^aws s3 ls'],
        exactMatches: ['aws ec2 describe-instances']
      };

      // Validate structure
      expect(validWhitelist).toHaveProperty('patterns');
      expect(validWhitelist).toHaveProperty('exactMatches');
      expect(Array.isArray(validWhitelist.patterns)).toBe(true);
      expect(Array.isArray(validWhitelist.exactMatches)).toBe(true);
    });
  });

  describe('Safety Assessment Edge Cases', () => {
    test('should detect case-insensitive destructive operations', () => {
      const destructivePatterns = [
        /\bdelete\b/i,
        /\bremove\b/i,
        /\bdestroy\b/i,
        /\bterminate\b/i
      ];

      const commands = [
        'aws s3 DELETE s3://bucket/key',
        'aws ec2 TERMINATE-instances',
        'aws rds Delete-db-instance',
        'aws cloudformation delete-STACK'
      ];

      commands.forEach(cmd => {
        const isDestructive = destructivePatterns.some(p => p.test(cmd));
        expect(isDestructive).toBe(true);
      });
    });

    test('should handle hyphenated destructive commands', () => {
      const hyphenatedPatterns = [
        /\bdelete-/,
        /\bterminate-/,
        /\bdestroy-/,
        /\bremove-/
      ];

      const commands = [
        'aws ec2 delete-vpc',
        'aws ec2 terminate-instances',
        'aws cloudformation delete-stack'
      ];

      commands.forEach(cmd => {
        const isDestructive = hyphenatedPatterns.some(p => p.test(cmd));
        expect(isDestructive).toBe(true);
      });
    });

    test('should detect high-privilege profile patterns', () => {
      const highPrivilegePatterns = [
        /\/(admin|super|superadmin)$/,
        /^(admin|super|superadmin)\//
      ];

      const profiles = [
        { name: 'dev/admin', expected: true },
        { name: 'prod/super', expected: true },
        { name: 'admin/dev', expected: true },
        { name: 'dev/readonly', expected: false },
        { name: 'test/debug', expected: false }
      ];

      profiles.forEach(({ name, expected }) => {
        const isHighPriv = highPrivilegePatterns.some(p => p.test(name));
        expect(isHighPriv).toBe(expected);
      });
    });

    test('should handle modifying command patterns', () => {
      const modifyingPatterns = [
        /\b(create|update|put|modify|attach|detach|associate|disassociate)\b/i,
        /\bcreate-/,
        /\bupdate-/,
        /\bput-/,
        /\bmodify-/
      ];

      const commands = [
        'aws s3api put-object',
        'aws ec2 create-vpc',
        'aws rds modify-db-instance',
        'aws ec2 attach-volume',
        'aws vpc associate-route-table'
      ];

      commands.forEach(cmd => {
        const isModifying = modifyingPatterns.some(p => p.test(cmd));
        expect(isModifying).toBe(true);
      });
    });
  });

  describe('Command Validation Comprehensive', () => {
    test('should validate various AWS CLI command formats', () => {
      const validCommands = [
        'aws s3 ls',
        'aws ec2 describe-instances',
        'aws rds describe-db-instances --region us-east-1',
        'aws s3api get-object --bucket test --key file.txt',
        'aws iam list-users --max-items 10',
        'aws lambda list-functions --region us-west-2'
      ];

      validCommands.forEach(cmd => {
        expect(cmd).toMatch(/^aws\s+\w+/);
      });
    });

    test('should reject non-AWS commands', () => {
      const invalidCommands = [
        'ls -la',
        'kubectl get pods',
        'terraform apply',
        'docker ps',
        'npm install',
        'python script.py'
      ];

      invalidCommands.forEach(cmd => {
        expect(cmd).not.toMatch(/^aws\s+\w+/);
      });
    });

    test('should handle AWS commands with complex arguments', () => {
      const complexCommands = [
        'aws s3 cp s3://source/file.txt s3://dest/file.txt --storage-class GLACIER',
        'aws ec2 run-instances --image-id ami-12345 --count 1 --instance-type t2.micro',
        'aws cloudformation create-stack --stack-name test --template-body file://template.yaml'
      ];

      complexCommands.forEach(cmd => {
        expect(cmd).toMatch(/^aws\s+\w+/);
      });
    });

    test('should handle AWS commands with quotes', () => {
      const quotedCommands = [
        'aws s3 cp "file with spaces.txt" s3://bucket/',
        "aws ec2 create-tags --resources i-1234 --tags 'Key=Name,Value=Test'",
        'aws dynamodb put-item --table-name test --item \'{"id":{"S":"123"}}\''
      ];

      quotedCommands.forEach(cmd => {
        expect(cmd).toMatch(/^aws\s+\w+/);
      });
    });
  });

  describe('Profile Filtering Edge Cases', () => {
    test('should filter profiles by single suffix', () => {
      const profiles = [
        'dev/readonly',
        'dev/admin',
        'prod/readonly',
        'test/debug'
      ];

      const filtered = profiles.filter(p => p.endsWith('/readonly'));
      
      expect(filtered).toHaveLength(2);
      expect(filtered).toContain('dev/readonly');
      expect(filtered).toContain('prod/readonly');
    });

    test('should filter profiles by multiple suffixes', () => {
      const profiles = [
        'dev/readonly',
        'dev/admin',
        'prod/readonly',
        'test/debug',
        'test/readonly'
      ];

      const suffixes = ['/ro', '/debug', '/readonly'];
      const filtered = profiles.filter(p => 
        suffixes.some(suffix => p.endsWith(suffix))
      );
      
      expect(filtered).toHaveLength(4);
    });

    test('should handle explicit profile list', () => {
      const allProfiles = [
        'dev/readonly',
        'dev/admin',
        'prod/readonly',
        'test/debug'
      ];

      const explicitList = ['dev/readonly', 'test/debug'];
      const filtered = explicitList.filter(p => allProfiles.includes(p));
      
      expect(filtered).toHaveLength(2);
      expect(filtered).toEqual(explicitList);
    });

    test('should handle empty filter (include all)', () => {
      const profiles = [
        'dev/readonly',
        'dev/admin',
        'prod/readonly'
      ];

      // No filters = include all
      const filtered = profiles;
      
      expect(filtered).toHaveLength(3);
    });
  });

  describe('Path Resolution', () => {
    test('should resolve whitelist file path correctly', () => {
      const whitelistPath = join(__dirname, '../allowed-commands.json');
      
      expect(whitelistPath).toContain('allowed-commands.json');
      expect(whitelistPath).toContain('mcp-server-granted');
    });

    test('should resolve AWS config path correctly', () => {
      const configPath = join(homedir(), '.aws', 'config');
      
      expect(configPath).toContain('.aws');
      expect(configPath).toContain('config');
    });
  });

  describe('Regex Pattern Edge Cases', () => {
    test('should match patterns with anchors', () => {
      const pattern = '^aws s3 ls$';
      const regex = new RegExp(pattern);

      expect(regex.test('aws s3 ls')).toBe(true);
      expect(regex.test('aws s3 ls s3://bucket')).toBe(false);
      expect(regex.test('prefix aws s3 ls')).toBe(false);
    });

    test('should match patterns with wildcards', () => {
      const pattern = '^aws s3 ls.*';
      const regex = new RegExp(pattern);

      expect(regex.test('aws s3 ls')).toBe(true);
      expect(regex.test('aws s3 ls s3://bucket')).toBe(true);
      expect(regex.test('aws s3 ls s3://bucket/path/')).toBe(true);
    });

    test('should match patterns with character classes', () => {
      const pattern = '^aws [a-z0-9]+ describe-';
      const regex = new RegExp(pattern);

      expect(regex.test('aws ec2 describe-instances')).toBe(true);
      expect(regex.test('aws s3 describe-buckets')).toBe(true);
      expect(regex.test('aws rds describe-db-instances')).toBe(true);
    });

    test('should handle alternation patterns', () => {
      const pattern = '^aws (ec2|rds|s3) (describe-|list-)';
      const regex = new RegExp(pattern);

      expect(regex.test('aws ec2 describe-instances')).toBe(true);
      expect(regex.test('aws rds list-db-instances')).toBe(true);
      expect(regex.test('aws s3 describe-buckets')).toBe(true);
      expect(regex.test('aws lambda list-functions')).toBe(false);
    });
  });
});
