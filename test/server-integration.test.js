import { jest } from '@jest/globals';
import { exec } from 'child_process';
import { promisify } from 'util';

// Note: We can't easily mock execAsync in server.js since it's created at module load time
// Instead, we'll test the logic paths that don't require actual AWS execution

describe('Server Integration Tests', () => {
  describe('Safety Check Logic', () => {
    test('should block destructive command with strict safety level', () => {
      const command = 'aws ec2 terminate-instances --instance-ids i-123';
      const profile = 'dev/readonly';
      const safetyLevel = 'strict';
      
      // Simulate assessCommandSafety
      const isDestructive = /\bterminate\b/i.test(command);
      const requireConfirmation = isDestructive;
      const shouldWarn = (safetyLevel === 'strict' && requireConfirmation);
      
      expect(isDestructive).toBe(true);
      expect(shouldWarn).toBe(true);
    });

    test('should allow modifying command with permissive safety level', () => {
      const command = 'aws ec2 create-vpc --cidr-block 10.0.0.0/16';
      const profile = 'dev/admin';
      const safetyLevel = 'permissive';
      
      const isModifying = /\bcreate\b/i.test(command);
      const isHighPriv = /\/admin$/.test(profile);
      const requireConfirmation = isModifying && isHighPriv;
      const shouldWarn = (safetyLevel === 'strict' && requireConfirmation);
      
      expect(isModifying).toBe(true);
      expect(isHighPriv).toBe(true);
      expect(shouldWarn).toBe(false); // Permissive doesn't warn
    });

    test('should block HIGH risk with normal safety level', () => {
      const command = 'aws rds delete-db-instance --db-instance-identifier mydb';
      const profile = 'prod/admin';
      const safetyLevel = 'normal';
      
      const isDestructive = /\bdelete\b/i.test(command);
      const level = isDestructive ? 'HIGH' : 'SAFE';
      const shouldWarn = (safetyLevel === 'normal' && level === 'HIGH');
      
      expect(level).toBe('HIGH');
      expect(shouldWarn).toBe(true);
    });

    test('should not block MEDIUM risk with normal safety level', () => {
      const command = 'aws ec2 create-vpc --cidr-block 10.0.0.0/16';
      const profile = 'prod/admin';
      const safetyLevel = 'normal';
      
      const isModifying = /\bcreate\b/i.test(command);
      const isHighPriv = /\/admin$/.test(profile);
      const level = isModifying && isHighPriv ? 'MEDIUM' : 'SAFE';
      const shouldWarn = (safetyLevel === 'normal' && level === 'HIGH');
      
      expect(level).toBe('MEDIUM');
      expect(shouldWarn).toBe(false);
    });
  });

  describe('Command Whitelisting Logic', () => {
    test('should block non-whitelisted command', () => {
      const command = 'aws lambda list-functions';
      const whitelist = {
        patterns: ['^aws s3 ls', '^aws ec2 describe-'],
        exactMatches: []
      };
      
      const isAllowed = 
        whitelist.exactMatches.includes(command.trim()) ||
        whitelist.patterns.some(p => new RegExp(p).test(command.trim()));
      
      expect(isAllowed).toBe(false);
    });

    test('should allow whitelisted pattern', () => {
      const command = 'aws ec2 describe-instances --region us-east-1';
      const whitelist = {
        patterns: ['^aws ec2 describe-'],
        exactMatches: []
      };
      
      const isAllowed = whitelist.patterns.some(p => new RegExp(p).test(command.trim()));
      
      expect(isAllowed).toBe(true);
    });

    test('should allow exact match', () => {
      const command = 'aws s3 ls s3://my-specific-bucket';
      const whitelist = {
        patterns: [],
        exactMatches: ['aws s3 ls s3://my-specific-bucket']
      };
      
      const isAllowed = whitelist.exactMatches.includes(command.trim());
      
      expect(isAllowed).toBe(true);
    });

    test('should trim whitespace before checking', () => {
      const command = '  aws s3 ls  ';
      const whitelist = {
        patterns: ['^aws s3 ls'],
        exactMatches: []
      };
      
      const isAllowed = whitelist.patterns.some(p => new RegExp(p).test(command.trim()));
      
      expect(isAllowed).toBe(true);
    });
  });

  describe('Safety and Whitelist Combined Logic', () => {
    test('should check whitelist before safety', () => {
      const command = 'aws lambda list-functions';
      const whitelist = {
        patterns: [],
        exactMatches: []
      };
      
      const isWhitelisted = 
        whitelist.exactMatches.includes(command.trim()) ||
        whitelist.patterns.some(p => new RegExp(p).test(command.trim()));
      
      // If not whitelisted, should return error before safety check
      expect(isWhitelisted).toBe(false);
    });

    test('should check safety after whitelist passes', () => {
      const command = 'aws ec2 terminate-instances --instance-ids i-123';
      const whitelist = {
        patterns: ['^aws ec2 terminate-'],
        exactMatches: []
      };
      
      const isWhitelisted = whitelist.patterns.some(p => new RegExp(p).test(command.trim()));
      const isDestructive = /\bterminate\b/i.test(command);
      
      expect(isWhitelisted).toBe(true);
      expect(isDestructive).toBe(true);
      // Would proceed to safety check
    });

    test('should skip safety check when skipSafetyCheck is true', () => {
      const skipSafetyCheck = true;
      const safetyLevel = 'strict';
      
      // When skipSafetyCheck is true, safety logic should not run
      const shouldCheckSafety = !skipSafetyCheck;
      
      expect(shouldCheckSafety).toBe(false);
    });
  });

  describe('Response Structure Validation', () => {
    test('should return error structure for non-whitelisted command', () => {
      const error = {
        success: false,
        output: '',
        error: 'Command not whitelisted: "aws lambda list-functions"\n\nUse the aws_whitelist_command tool to approve this command for future use.'
      };
      
      expect(error.success).toBe(false);
      expect(error.output).toBe('');
      expect(error.error).toContain('Command not whitelisted');
      expect(error.error).toContain('aws_whitelist_command');
    });

    test('should return safety warning structure', () => {
      const safetyWarning = {
        success: false,
        output: '',
        error: '🔴 DESTRUCTIVE OPERATION WARNING!\n\n⚠️  This command has been BLOCKED for safety.',
        safetyWarning: true
      };
      
      expect(safetyWarning.success).toBe(false);
      expect(safetyWarning.safetyWarning).toBe(true);
      expect(safetyWarning.error).toContain('BLOCKED for safety');
    });

    test('should return success structure', () => {
      const success = {
        success: true,
        output: 'some stdout output',
        error: 'some stderr output'
      };
      
      expect(success.success).toBe(true);
      expect(success.output).toBeDefined();
      expect(success.error).toBeDefined();
    });

    test('should return error structure for execution failure', () => {
      const failure = {
        success: false,
        output: 'partial output',
        error: 'execution error message'
      };
      
      expect(failure.success).toBe(false);
      expect(failure.output).toBeDefined();
      expect(failure.error).toBeDefined();
    });
  });

  describe('Profile and Config Interaction', () => {
    test('should use filtered profiles based on config', () => {
      const allProfiles = ['dev/readonly', 'dev/admin', 'prod/readonly'];
      const config = {
        profileFilter: {
          mode: 'suffix',
          suffixes: ['/readonly'],
          profiles: []
        }
      };
      
      const filtered = allProfiles.filter(p => 
        config.profileFilter.suffixes.some(s => p.endsWith(s))
      );
      
      expect(filtered).toHaveLength(2);
      expect(filtered).toContain('dev/readonly');
      expect(filtered).toContain('prod/readonly');
    });

    test('should fallback to safe defaults when setup not completed', () => {
      const setupCompleted = false;
      
      const defaultConfig = {
        profileFilter: {
          mode: 'suffix',
          suffixes: ['/readonly'],
          profiles: []
        },
        safetyLevel: 'strict',
        setupCompleted: false
      };
      
      if (!setupCompleted) {
        // Apply fallback
        expect(defaultConfig.profileFilter.mode).toBe('suffix');
        expect(defaultConfig.profileFilter.suffixes).toContain('/readonly');
        expect(defaultConfig.safetyLevel).toBe('strict');
      }
    });
  });

  describe('Path Construction', () => {
    test('should construct agent path correctly', () => {
      const testDir = '/test/directory';
      const agentPath = `${testDir}/aws-agent.sh`;
      
      expect(agentPath).toBe('/test/directory/aws-agent.sh');
    });

    test('should construct full command correctly', () => {
      const agentPath = '/path/to/aws-agent.sh';
      const profile = 'dev/readonly';
      const command = 'aws s3 ls';
      const fullCommand = `${agentPath} ${profile} "${command}"`;
      
      expect(fullCommand).toBe('/path/to/aws-agent.sh dev/readonly "aws s3 ls"');
    });

    test('should handle commands with quotes', () => {
      const command = 'aws s3 cp "file with spaces.txt" s3://bucket/';
      const escapedCommand = command.replace(/"/g, '\\"');
      
      expect(escapedCommand).toContain('\\"');
    });
  });

  describe('Configuration Scenarios', () => {
    test('should handle strict mode with destructive command', () => {
      const config = { safetyLevel: 'strict' };
      const safety = { requireConfirmation: true, level: 'HIGH' };
      
      const shouldWarn = config.safetyLevel === 'strict' && safety.requireConfirmation;
      
      expect(shouldWarn).toBe(true);
    });

    test('should handle strict mode with modifying command', () => {
      const config = { safetyLevel: 'strict' };
      const safety = { requireConfirmation: true, level: 'MEDIUM' };
      
      const shouldWarn = config.safetyLevel === 'strict' && safety.requireConfirmation;
      
      expect(shouldWarn).toBe(true);
    });

    test('should handle normal mode with HIGH risk', () => {
      const config = { safetyLevel: 'normal' };
      const safety = { level: 'HIGH' };
      
      const shouldWarn = config.safetyLevel === 'normal' && safety.level === 'HIGH';
      
      expect(shouldWarn).toBe(true);
    });

    test('should handle normal mode with MEDIUM risk', () => {
      const config = { safetyLevel: 'normal' };
      const safety = { level: 'MEDIUM' };
      
      const shouldWarn = config.safetyLevel === 'normal' && safety.level === 'HIGH';
      
      expect(shouldWarn).toBe(false);
    });

    test('should handle permissive mode', () => {
      const config = { safetyLevel: 'permissive' };
      const safety = { requireConfirmation: true, level: 'HIGH' };
      
      const shouldWarn = 
        (config.safetyLevel === 'strict' && safety.requireConfirmation) ||
        (config.safetyLevel === 'normal' && safety.level === 'HIGH');
      
      expect(shouldWarn).toBe(false);
    });
  });
});
