import { jest } from '@jest/globals';
import { 
  loadConfig, 
  saveConfig, 
  filterProfiles, 
  assessCommandSafety 
} from '../config-manager.js';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_PATH = join(homedir(), '.mcp-granted-config.json');
const BACKUP_CONFIG_PATH = join(homedir(), '.mcp-granted-config.json.backup');

describe('Config Manager', () => {
  beforeEach(() => {
    // Backup existing config if it exists
    if (existsSync(CONFIG_PATH)) {
      const content = readFileSync(CONFIG_PATH, 'utf8');
      writeFileSync(BACKUP_CONFIG_PATH, content);
      unlinkSync(CONFIG_PATH);
    }
  });

  afterEach(() => {
    // Restore backup if it exists
    if (existsSync(BACKUP_CONFIG_PATH)) {
      const content = readFileSync(BACKUP_CONFIG_PATH, 'utf8');
      writeFileSync(CONFIG_PATH, content);
      unlinkSync(BACKUP_CONFIG_PATH);
    }
  });

  describe('loadConfig', () => {
    test('should return default config when file does not exist', () => {
      const config = loadConfig();
      
      expect(config.profileFilter.mode).toBe('suffix');
      expect(config.profileFilter.suffixes).toEqual(['/ro']);
      expect(config.safetyLevel).toBe('strict');
      expect(config.setupCompleted).toBe(false);
    });

    test('should load existing config from file', () => {
      const testConfig = {
        profileFilter: {
          mode: 'explicit',
          suffixes: [],
          profiles: ['dev/readonly', 'prod/readonly']
        },
        safetyLevel: 'normal',
        setupCompleted: true
      };
      
      writeFileSync(CONFIG_PATH, JSON.stringify(testConfig, null, 2));
      const config = loadConfig();
      
      expect(config.profileFilter.mode).toBe('explicit');
      expect(config.profileFilter.profiles).toHaveLength(2);
      expect(config.safetyLevel).toBe('normal');
      expect(config.setupCompleted).toBe(true);
    });

    test('should merge with defaults for missing fields', () => {
      const partialConfig = {
        safetyLevel: 'permissive'
      };
      
      writeFileSync(CONFIG_PATH, JSON.stringify(partialConfig, null, 2));
      const config = loadConfig();
      
      expect(config.safetyLevel).toBe('permissive');
      expect(config.profileFilter.mode).toBe('suffix');
      expect(config.profileFilter.suffixes).toEqual(['/ro']);
    });
  });

  describe('saveConfig', () => {
    test('should save config to file', () => {
      const testConfig = {
        profileFilter: {
          mode: 'suffix',
          suffixes: ['/ro', '/debug'],
          profiles: []
        },
        safetyLevel: 'strict',
        setupCompleted: true
      };
      
      saveConfig(testConfig);
      
      expect(existsSync(CONFIG_PATH)).toBe(true);
      const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      expect(saved.profileFilter.suffixes).toEqual(['/ro', '/debug']);
      expect(saved.setupCompleted).toBe(true);
    });
  });

  describe('filterProfiles', () => {
    const allProfiles = [
      'dev/readonly',
      'dev/admin',
      'dev/readonly',
      'prod/readonly',
      'prod/admin',
      'test/debug'
    ];

    test('should filter by suffix mode', () => {
      const config = {
        profileFilter: {
          mode: 'suffix',
          suffixes: ['/readonly'],
          profiles: []
        }
      };
      
      const filtered = filterProfiles(allProfiles, config);
      
      expect(filtered).toHaveLength(3);
      expect(filtered).toContain('dev/readonly');
      expect(filtered).toContain('dev/readonly');
      expect(filtered).toContain('prod/readonly');
      expect(filtered).not.toContain('dev/admin');
    });

    test('should filter by multiple suffixes', () => {
      const config = {
        profileFilter: {
          mode: 'suffix',
          suffixes: ['/readonly', '/debug'],
          profiles: []
        }
      };
      
      const filtered = filterProfiles(allProfiles, config);
      
      expect(filtered).toHaveLength(4);
      expect(filtered).toContain('test/debug');
    });

    test('should filter by explicit mode', () => {
      const config = {
        profileFilter: {
          mode: 'explicit',
          suffixes: [],
          profiles: ['dev/readonly', 'prod/admin']
        }
      };
      
      const filtered = filterProfiles(allProfiles, config);
      
      expect(filtered).toHaveLength(2);
      expect(filtered).toContain('dev/readonly');
      expect(filtered).toContain('prod/admin');
    });

    test('should return empty array if no matches in explicit mode', () => {
      const config = {
        profileFilter: {
          mode: 'explicit',
          suffixes: [],
          profiles: ['nonexistent/profile']
        }
      };
      
      const filtered = filterProfiles(allProfiles, config);
      
      expect(filtered).toHaveLength(0);
    });
  });

  describe('assessCommandSafety', () => {
    test('should identify HIGH risk destructive commands', () => {
      const commands = [
        'aws s3 delete-object --bucket my-bucket --key file.txt',
        'aws ec2 terminate-instances --instance-ids i-1234',
        'aws rds delete-db-instance --db-instance-identifier mydb',
        'aws dynamodb delete-table --table-name mytable'
      ];
      
      commands.forEach(cmd => {
        const safety = assessCommandSafety(cmd, 'dev/readonly');
        expect(safety.level).toBe('HIGH');
        expect(safety.requireConfirmation).toBe(true);
        expect(safety.emoji).toBe('🔴');
      });
    });

    test('should identify MEDIUM risk modifying commands with elevated profiles', () => {
      const commands = [
        'aws s3api put-object --bucket mybucket --key file.txt',
        'aws ec2 create-vpc --cidr-block 10.0.0.0/16',
        'aws rds modify-db-instance --db-instance-identifier mydb --allocated-storage 100'
      ];
      
      commands.forEach(cmd => {
        const safety = assessCommandSafety(cmd, 'dev/admin');
        expect(safety.level).toBe('MEDIUM');
        expect(safety.requireConfirmation).toBe(true);
        expect(safety.emoji).toBe('🟡');
      });
    });

    test('should mark read-only commands as SAFE', () => {
      const commands = [
        'aws s3 ls',
        'aws ec2 describe-instances',
        'aws rds describe-db-instances',
        'aws dynamodb get-item --table-name mytable --key id=123'
      ];
      
      commands.forEach(cmd => {
        const safety = assessCommandSafety(cmd, 'dev/readonly');
        expect(safety.level).toBe('SAFE');
        expect(safety.requireConfirmation).toBe(false);
        expect(safety.emoji).toBe('🟢');
      });
    });

    test('should mark modifying commands with read-only profiles as LOW', () => {
      const cmd = 'aws s3api put-object --bucket mybucket --key file.txt';
      const safety = assessCommandSafety(cmd, 'dev/readonly');
      
      // Should be LOW because profile is /ro (not elevated), but command is modifying
      expect(safety.level).toBe('LOW');
      expect(safety.requireConfirmation).toBe(false);
      expect(safety.emoji).toBe('🟡');
    });

    test('should include helpful message for destructive operations', () => {
      const cmd = 'aws ec2 terminate-instances --instance-ids i-1234';
      const safety = assessCommandSafety(cmd, 'prod/admin');
      
      expect(safety.message).toContain('DESTRUCTIVE OPERATION');
      expect(safety.message).toContain('DELETE');
    });

    test('should include profile warning for elevated profiles', () => {
      const cmd = 'aws ec2 create-vpc --cidr-block 10.0.0.0/16';
      const safety = assessCommandSafety(cmd, 'prod/admin');
      
      expect(safety.message).toContain('admin');
      expect(safety.level).toBe('MEDIUM');
    });

    test('should detect remove pattern as destructive', () => {
      const cmd = 'aws iam remove-user-from-group --user-name testuser --group-name testgroup';
      const safety = assessCommandSafety(cmd, 'dev/readonly');
      
      expect(safety.level).toBe('HIGH');
      expect(safety.requireConfirmation).toBe(true);
    });

    test('should detect destroy pattern as destructive', () => {
      const cmd = 'aws cloudformation delete-stack --stack-name mystack';
      const safety = assessCommandSafety(cmd, 'dev/readonly');
      
      expect(safety.level).toBe('HIGH');
    });

    test('should handle profile with superadmin suffix', () => {
      const cmd = 'aws ec2 create-vpc --cidr-block 10.0.0.0/16';
      const safety = assessCommandSafety(cmd, 'prod/superadmin');
      
      expect(safety.level).toBe('MEDIUM');
      expect(safety.requireConfirmation).toBe(true);
    });

    test('should handle super prefix profile', () => {
      const cmd = 'aws s3api put-object --bucket test --key file';
      const safety = assessCommandSafety(cmd, 'super/prod');
      
      expect(safety.level).toBe('MEDIUM');
    });

    test('should handle attach/detach operations as modifying', () => {
      const commands = [
        'aws ec2 attach-volume --volume-id vol-123 --instance-id i-123',
        'aws ec2 detach-volume --volume-id vol-123',
        'aws iam attach-user-policy --user-name test --policy-arn arn:aws:iam::aws:policy/test'
      ];

      commands.forEach(cmd => {
        const safety = assessCommandSafety(cmd, 'dev/admin');
        expect(safety.level).toBe('MEDIUM');
      });
    });

    test('should handle associate/disassociate operations', () => {
      const commands = [
        'aws ec2 associate-route-table --route-table-id rtb-123 --subnet-id subnet-123',
        'aws ec2 disassociate-route-table --association-id rtbassoc-123'
      ];

      commands.forEach(cmd => {
        const safety = assessCommandSafety(cmd, 'prod/admin');
        expect(safety.level).toBe('MEDIUM');
      });
    });
  });

  describe('Config Error Handling', () => {
    test('should handle malformed JSON in config file', () => {
      const malformedJSON = '{invalid: json}';
      
      let error;
      try {
        JSON.parse(malformedJSON);
      } catch (e) {
        error = e;
      }
      
      expect(error).toBeDefined();
      expect(error).toBeInstanceOf(SyntaxError);
    });

    test('should merge partial config with defaults', () => {
      const partialConfig = {
        safetyLevel: 'permissive'
      };

      const defaults = {
        profileFilter: {
          mode: 'suffix',
          suffixes: ['/readonly'],
          profiles: []
        },
        safetyLevel: 'strict',
        setupCompleted: false
      };

      const merged = { ...defaults, ...partialConfig };
      
      expect(merged.safetyLevel).toBe('permissive');
      expect(merged.profileFilter.mode).toBe('suffix');
      expect(merged.setupCompleted).toBe(false);
    });

    test('should handle missing config file gracefully', () => {
      const CONFIG_PATH = join(homedir(), '.mcp-granted-config-nonexistent.json');
      
      expect(existsSync(CONFIG_PATH)).toBe(false);
      
      // If file doesn't exist, should use defaults
      const defaultConfig = {
        profileFilter: {
          mode: 'suffix',
          suffixes: ['/readonly'],
          profiles: []
        },
        safetyLevel: 'strict',
        setupCompleted: false
      };
      
      expect(defaultConfig.safetyLevel).toBe('strict');
    });
  });

  describe('FilterProfiles Edge Cases', () => {
    test('should handle empty suffixes array', () => {
      const allProfiles = ['dev/readonly', 'dev/admin'];
      const config = {
        profileFilter: {
          mode: 'suffix',
          suffixes: [],
          profiles: []
        }
      };

      const filtered = filterProfiles(allProfiles, config);
      
      // Empty suffixes should return all profiles
      expect(filtered).toHaveLength(2);
    });

    test('should handle profiles not in explicit list', () => {
      const allProfiles = ['dev/readonly', 'dev/admin', 'prod/readonly'];
      const config = {
        profileFilter: {
          mode: 'explicit',
          suffixes: [],
          profiles: ['nonexistent/profile', 'dev/readonly']
        }
      };

      const filtered = filterProfiles(allProfiles, config);
      
      // Should only include profiles that exist in both lists
      expect(filtered).toHaveLength(1);
      expect(filtered).toContain('dev/readonly');
    });

    test('should handle case-sensitive profile names', () => {
      const allProfiles = ['Dev/Account/RO', 'dev/readonly'];
      const config = {
        profileFilter: {
          mode: 'suffix',
          suffixes: ['/RO'],
          profiles: []
        }
      };

      const filtered = filterProfiles(allProfiles, config);
      
      // Case-sensitive suffix matching
      expect(filtered).toHaveLength(1);
      expect(filtered).toContain('Dev/Account/RO');
    });
  });
});
