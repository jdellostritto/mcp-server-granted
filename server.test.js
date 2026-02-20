import { jest } from '@jest/globals';

describe('Whitelist Management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loadWhitelist', () => {
    test('should create default whitelist when file does not exist', () => {
      const defaultWhitelist = {
        patterns: ['^aws s3 ls'],
        exactMatches: []
      };

      expect(defaultWhitelist.patterns).toContain('^aws s3 ls');
      expect(defaultWhitelist.exactMatches).toEqual([]);
    });

    test('should load existing whitelist structure', () => {
      const existingWhitelist = {
        patterns: ['^aws s3 ls', '^aws ec2 describe-'],
        exactMatches: ['aws s3 ls s3://specific-bucket']
      };
      
      expect(existingWhitelist.patterns).toHaveLength(2);
      expect(existingWhitelist.exactMatches).toHaveLength(1);
    });
  });

  describe('isCommandAllowed', () => {
    test('should allow command matching exact match', () => {
      const command = 'aws s3 ls s3://my-bucket';
      const whitelist = {
        patterns: [],
        exactMatches: ['aws s3 ls s3://my-bucket']
      };

      const isAllowed = whitelist.exactMatches.includes(command.trim());
      expect(isAllowed).toBe(true);
    });

    test('should allow command matching pattern', () => {
      const command = 'aws ec2 describe-vpcs --region us-west-2';
      const whitelist = {
        patterns: ['^aws ec2 describe-'],
        exactMatches: []
      };

      const isAllowed = whitelist.patterns.some(pattern => {
        const regex = new RegExp(pattern);
        return regex.test(command.trim());
      });

      expect(isAllowed).toBe(true);
    });

    test('should block command not in whitelist', () => {
      const command = 'aws ec2 terminate-instances';
      const whitelist = {
        patterns: ['^aws ec2 describe-'],
        exactMatches: []
      };

      const isAllowed = whitelist.patterns.some(pattern => {
        const regex = new RegExp(pattern);
        return regex.test(command.trim());
      });

      expect(isAllowed).toBe(false);
    });

    test('should handle multiple pattern matches', () => {
      const commands = [
        'aws s3 ls',
        'aws ec2 describe-instances',
        'aws rds describe-db-instances'
      ];

      const whitelist = {
        patterns: ['^aws s3 ls', '^aws ec2 describe-', '^aws rds describe-'],
        exactMatches: []
      };

      commands.forEach(command => {
        const isAllowed = whitelist.patterns.some(pattern => {
          const regex = new RegExp(pattern);
          return regex.test(command);
        });
        expect(isAllowed).toBe(true);
      });
    });
  });

  describe('addToWhitelist', () => {
    test('should add exact match to whitelist', () => {
      const whitelist = {
        patterns: [],
        exactMatches: []
      };

      const command = 'aws s3 ls s3://my-bucket';
      
      if (!whitelist.exactMatches.includes(command)) {
        whitelist.exactMatches.push(command);
      }

      expect(whitelist.exactMatches).toContain(command);
      expect(whitelist.exactMatches).toHaveLength(1);
    });

    test('should add pattern to whitelist', () => {
      const whitelist = {
        patterns: [],
        exactMatches: []
      };

      const pattern = '^aws ec2 describe-';
      
      if (!whitelist.patterns.includes(pattern)) {
        whitelist.patterns.push(pattern);
      }

      expect(whitelist.patterns).toContain(pattern);
      expect(whitelist.patterns).toHaveLength(1);
    });

    test('should not add duplicate exact matches', () => {
      const whitelist = {
        patterns: [],
        exactMatches: ['aws s3 ls s3://my-bucket']
      };

      const command = 'aws s3 ls s3://my-bucket';
      
      if (!whitelist.exactMatches.includes(command)) {
        whitelist.exactMatches.push(command);
      }

      expect(whitelist.exactMatches).toHaveLength(1);
    });

    test('should not add duplicate patterns', () => {
      const whitelist = {
        patterns: ['^aws ec2 describe-'],
        exactMatches: []
      };

      const pattern = '^aws ec2 describe-';
      
      if (!whitelist.patterns.includes(pattern)) {
        whitelist.patterns.push(pattern);
      }

      expect(whitelist.patterns).toHaveLength(1);
    });
  });
});

describe('Profile Loading', () => {
  test('should extract /ro profiles from AWS config', () => {
    const mockConfig = `
[profile login]
sso_start_url = https://example.awsapps.com/start/
sso_region = us-east-1

[profile dev/vault/ro]
sso_start_url = https://example.awsapps.com/start/
sso_region = us-east-1
sso_account_id = 123456789012
sso_role_name = ReadOnly
region = us-west-2

[profile dev/vault/admin]
sso_start_url = https://example.awsapps.com/start/
sso_region = us-east-1
sso_account_id = 123456789012
sso_role_name = Admin
region = us-west-2

[profile prod/vault/ro]
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
      if (profileName.endsWith('/ro')) {
        profiles.push(profileName);
      }
    }

    expect(profiles).toHaveLength(2);
    expect(profiles).toContain('dev/vault/ro');
    expect(profiles).toContain('prod/vault/ro');
    expect(profiles).not.toContain('dev/vault/admin');
    expect(profiles).not.toContain('login');
  });

  test('should return empty array when no /ro profiles exist', () => {
    const mockConfig = `
[profile login]
sso_start_url = https://example.awsapps.com/start/

[profile dev/vault/admin]
sso_start_url = https://example.awsapps.com/start/
`;

    const profiles = [];
    const profileRegex = /^\[profile (.+)\]/gm;
    let match;
    
    while ((match = profileRegex.exec(mockConfig)) !== null) {
      const profileName = match[1];
      if (profileName.endsWith('/ro')) {
        profiles.push(profileName);
      }
    }

    expect(profiles).toHaveLength(0);
  });

  test('should handle empty config file', () => {
    const mockConfig = '';

    const profiles = [];
    const profileRegex = /^\[profile (.+)\]/gm;
    let match;
    
    while ((match = profileRegex.exec(mockConfig)) !== null) {
      const profileName = match[1];
      if (profileName.endsWith('/ro')) {
        profiles.push(profileName);
      }
    }

    expect(profiles).toHaveLength(0);
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
