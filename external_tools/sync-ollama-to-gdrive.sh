#!/bin/bash

###############################################################################
# Ollama to Google Drive Sync Script
# Synchronizes Ollama models to Google Drive backup location
###############################################################################

set -e

OLLAMA_MODELS_DIR="/usr/share/ollama/.ollama/models"
GDRIVE_BACKUP_DIR="/home/yoda_external_storage_server/biz_automate/ollama_models"
LOG_FILE="/tmp/ollama-gdrive-sync.log"

echo "====================================================" | tee -a "$LOG_FILE"
echo "  🔄 Ollama → Google Drive Sync" | tee -a "$LOG_FILE"
echo "====================================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Source:      $OLLAMA_MODELS_DIR" | tee -a "$LOG_FILE"
echo "Destination: $GDRIVE_BACKUP_DIR" | tee -a "$LOG_FILE"
echo "Started:     $(date)" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Check if source exists
if [ ! -d "$OLLAMA_MODELS_DIR" ]; then
    echo "❌ Error: Ollama models directory not found at $OLLAMA_MODELS_DIR" | tee -a "$LOG_FILE"
    exit 1
fi

# Check if destination mount exists
if [ ! -d "$GDRIVE_BACKUP_DIR" ]; then
    echo "⚠️  Creating backup directory at $GDRIVE_BACKUP_DIR..." | tee -a "$LOG_FILE"
    mkdir -p "$GDRIVE_BACKUP_DIR"
fi

# Get current sizes
SOURCE_SIZE=$(du -sh "$OLLAMA_MODELS_DIR" | cut -f1)
DEST_SIZE=$(du -sh "$GDRIVE_BACKUP_DIR" | cut -f1)

echo "Current sizes:" | tee -a "$LOG_FILE"
echo "  Source:      $SOURCE_SIZE" | tee -a "$LOG_FILE"
echo "  Destination: $DEST_SIZE" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Perform sync with rsync
echo "🔄 Starting sync..." | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

rsync -avh \
    --progress \
    --delete \
    --stats \
    "$OLLAMA_MODELS_DIR/" \
    "$GDRIVE_BACKUP_DIR/" \
    2>&1 | tee -a "$LOG_FILE"

# Check exit status
if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo "" | tee -a "$LOG_FILE"
    echo "✅ Sync completed successfully!" | tee -a "$LOG_FILE"
    echo "Finished: $(date)" | tee -a "$LOG_FILE"

    # Show final size
    FINAL_SIZE=$(du -sh "$GDRIVE_BACKUP_DIR" | cut -f1)
    echo "Final backup size: $FINAL_SIZE" | tee -a "$LOG_FILE"
else
    echo "" | tee -a "$LOG_FILE"
    echo "❌ Sync failed with errors. Check log at $LOG_FILE" | tee -a "$LOG_FILE"
    exit 1
fi

echo "" | tee -a "$LOG_FILE"
echo "====================================================" | tee -a "$LOG_FILE"
echo "Log saved to: $LOG_FILE" | tee -a "$LOG_FILE"
echo "====================================================" | tee -a "$LOG_FILE"
