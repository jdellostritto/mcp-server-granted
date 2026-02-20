#!/bin/bash

# AWS Credential Cache Manager
# Assumes roles and caches credentials with expiration tracking

set -euo pipefail

CREDS_DIR="$HOME/mcp-server-granted/credentials"
mkdir -p "$CREDS_DIR"

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

# Load profiles into array (macOS compatible)
RO_PROFILES=($(load_ro_profiles))

# Function to get credential file path
get_cred_file() {
    local profile=$1
    echo "$CREDS_DIR/${profile//\//_}.env"
}

# Function to get expiration file path
get_expiry_file() {
    local profile=$1
    echo "$CREDS_DIR/${profile//\//_}.expiry"
}

# Check if credentials are still valid
are_creds_valid() {
    local profile=$1
    local cred_file=$(get_cred_file "$profile")
    local expiry_file=$(get_expiry_file "$profile")
    
    # Check if files exist
    if [ ! -f "$cred_file" ] || [ ! -f "$expiry_file" ]; then
        return 1
    fi
    
    # Check expiration time
    local expiry=$(cat "$expiry_file")
    local now=$(date +%s)
    
    if [ "$now" -lt "$expiry" ]; then
        return 0
    else
        return 1
    fi
}

# Assume role and cache credentials
assume_and_cache() {
    local profile=$1
    local cred_file=$(get_cred_file "$profile")
    local expiry_file=$(get_expiry_file "$profile")
    
    echo "Assuming role: $profile..." >&2
    
    # Use granted credential-process to get credentials
    local cred_json
    if ! cred_json=$(granted credential-process --profile "$profile" 2>&1); then
        # Check if this is an SSO token error
        if echo "$cred_json" | grep -q "error retrieving IAM Identity Center token"; then
            echo "SSO session expired. Initiating SSO login..." >&2
            
            # Extract SSO details from AWS config
            local sso_start_url=$(grep -A 5 "^\[profile $profile\]" "$HOME/.aws/config" | grep "sso_start_url" | awk '{print $3}')
            local sso_region=$(grep -A 5 "^\[profile $profile\]" "$HOME/.aws/config" | grep "sso_region" | awk '{print $3}')
            
            if [ -z "$sso_start_url" ] || [ -z "$sso_region" ]; then
                echo "Error: Could not extract SSO configuration from ~/.aws/config" >&2
                return 1
            fi
            
            # Trigger SSO login
            echo "Running: granted sso login --sso-start-url $sso_start_url --sso-region $sso_region" >&2
            if ! granted sso login --sso-start-url "$sso_start_url" --sso-region "$sso_region"; then
                echo "Error: SSO login failed" >&2
                return 1
            fi
            
            # Retry credential fetch after SSO login
            echo "Retrying credential fetch..." >&2
            if ! cred_json=$(granted credential-process --profile "$profile" 2>&1); then
                echo "Error: Failed to assume role $profile after SSO login" >&2
                echo "$cred_json" >&2
                return 1
            fi
        else
            echo "Error: Failed to assume role $profile" >&2
            echo "$cred_json" >&2
            return 1
        fi
    fi
    
    # Parse JSON and export to file in AWS environment variable format
    echo "AWS_ACCESS_KEY_ID=$(echo "$cred_json" | grep -o '"AccessKeyId":"[^"]*"' | cut -d'"' -f4)" > "$cred_file"
    echo "AWS_SECRET_ACCESS_KEY=$(echo "$cred_json" | grep -o '"SecretAccessKey":"[^"]*"' | cut -d'"' -f4)" >> "$cred_file"
    echo "AWS_SESSION_TOKEN=$(echo "$cred_json" | grep -o '"SessionToken":"[^"]*"' | cut -d'"' -f4)" >> "$cred_file"
    
    # Set expiration time (credentials typically last 1 hour, we'll refresh after 50 minutes)
    local expiry=$(($(date +%s) + 3000))  # 50 minutes from now
    echo "$expiry" > "$expiry_file"
    
    echo "✓ Credentials cached for $profile (valid for 50 minutes)" >&2
}

# Get credentials for a profile (from cache or fresh)
get_credentials() {
    local profile=$1
    
    if are_creds_valid "$profile"; then
        echo "Using cached credentials for $profile" >&2
    else
        assume_and_cache "$profile"
    fi
    
    # Return the credential file path
    get_cred_file "$profile"
}

# Refresh all cached credentials
refresh_all() {
    echo "Refreshing all cached credentials..."
    for profile in "${RO_PROFILES[@]}"; do
        assume_and_cache "$profile"
    done
    echo "✓ All credentials refreshed"
}

# List credential status
list_status() {
    echo "AWS Credential Cache Status:"
    echo "============================"
    echo ""
    
    for profile in "${RO_PROFILES[@]}"; do
        local cred_file=$(get_cred_file "$profile")
        local expiry_file=$(get_expiry_file "$profile")
        
        if [ -f "$cred_file" ] && [ -f "$expiry_file" ]; then
            local expiry=$(cat "$expiry_file")
            local now=$(date +%s)
            local remaining=$((expiry - now))
            
            if [ $remaining -gt 0 ]; then
                local minutes=$((remaining / 60))
                echo "✓ $profile - Valid (${minutes}m remaining)"
            else
                echo "✗ $profile - Expired"
            fi
        else
            echo "○ $profile - Not cached"
        fi
    done
}

# Clear all cached credentials
clear_cache() {
    echo "Clearing credential cache..."
    rm -f "$CREDS_DIR"/*.env
    rm -f "$CREDS_DIR"/*.expiry
    echo "✓ Cache cleared"
}

# Main function
main() {
    case "${1:-help}" in
        get)
            if [ -z "${2:-}" ]; then
                echo "Error: Profile name required"
                echo "Usage: $0 get <profile>"
                exit 1
            fi
            get_credentials "$2"
            ;;
        refresh-all)
            refresh_all
            ;;
        status)
            list_status
            ;;
        clear)
            clear_cache
            ;;
        help|*)
            echo "AWS Credential Cache Manager"
            echo ""
            echo "Usage: $0 <command> [options]"
            echo ""
            echo "Commands:"
            echo "  get <profile>   Get credentials for profile (cached or fresh)"
            echo "  refresh-all     Refresh all cached credentials"
            echo "  status          Show credential cache status"
            echo "  clear           Clear all cached credentials"
            echo ""
            echo "Available profiles:"
            for profile in "${RO_PROFILES[@]}"; do
                echo "  - $profile"
            done
            ;;
    esac
}

main "$@"
