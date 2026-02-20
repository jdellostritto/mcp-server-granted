#!/bin/bash

# AWS Multi-Account Agent
# Runs AWS CLI commands across multiple profiles using cached credentials

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRED_CACHE="$SCRIPT_DIR/cred-cache.sh"
CREDS_DIR="$HOME/mcp-server-granted/credentials"

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Run AWS command with cached credentials for a specific profile
run_with_profile() {
    local profile=$1
    shift
    local aws_command="$@"
    
    # Get credentials (cached or fresh)
    local cred_file=$("$CRED_CACHE" get "$profile" 2>&1 | tail -1)
    
    if [ ! -f "$cred_file" ]; then
        echo -e "${RED}Failed to get credentials for $profile${NC}" >&2
        return 1
    fi
    
    # Source credentials and run AWS command
    (
        set -a
        source "$cred_file"
        set +a
        eval "$aws_command"
    )
}

# Run AWS command across multiple profiles
run_across_profiles() {
    local profiles=("$@")
    local aws_command="${!#}"  # Last argument is the command
    unset 'profiles[-1]'  # Remove command from profiles array
    
    for profile in "${profiles[@]}"; do
        echo -e "${BLUE}>>> Profile: ${profile}${NC}"
        if run_with_profile "$profile" "$aws_command"; then
            echo -e "${GREEN}✓ Success${NC}"
        else
            echo -e "${RED}✗ Failed${NC}"
        fi
        echo ""
    done
}

# Dynamically load /ro profiles from ~/.aws/config
load_ro_profiles() {
    if [ ! -f "$HOME/.aws/config" ]; then
        echo "Error: ~/.aws/config not found" >&2
        return 1
    fi
    
    grep '^\[profile ' "$HOME/.aws/config" | \
        sed 's/\[profile \(.*\)\]/\1/' | \
        grep '/ro$' | \
        sort
}

# Show help
show_help() {
    local profiles=($(load_ro_profiles))
    
    cat <<EOF
AWS Multi-Account Agent

Usage: 
  $0 <profile> <aws-command>          Run command in single profile
  $0 --all <aws-command>              Run command in all /ro profiles
  $0 --profiles p1,p2 <aws-command>   Run command in specific profiles
  $0 --status                         Show credential cache status
  $0 --refresh                        Refresh all cached credentials

Examples:
  $0 prod/readonly "aws s3 ls"
  $0 --all "aws ec2 describe-vpcs --output table"
  $0 --profiles dev/readonly,prod/readonly "aws s3 ls"
  $0 --status
  $0 --refresh

Available profiles:
EOF
    for profile in "${profiles[@]}"; do
        echo "  - $profile"
    done
}

# Main
main() {
    if [ $# -eq 0 ]; then
        show_help
        exit 0
    fi
    
    case "$1" in
        --status)
            "$CRED_CACHE" status
            ;;
        --refresh)
            "$CRED_CACHE" refresh-all
            ;;
        --all)
            shift
            all_profiles=($(load_ro_profiles))
            run_across_profiles "${all_profiles[@]}" "$@"
            ;;
        --profiles)
            shift
            local profile_list=$1
            shift
            IFS=',' read -ra profiles <<< "$profile_list"
            run_across_profiles "${profiles[@]}" "$@"
            ;;
        --help|-h)
            show_help
            ;;
        *)
            # Single profile mode
            local profile=$1
            shift
            run_with_profile "$profile" "$@"
            ;;
    esac
}

main "$@"
