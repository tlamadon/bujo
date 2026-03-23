#!/bin/sh
# Wait for CouchDB to be ready, then create the bujo database
set -e

COUCH_URL="http://${COUCHDB_USER:-admin}:${COUCHDB_PASSWORD:-changeme}@couchdb:5984"

echo "Waiting for CouchDB..."
until curl -sf "$COUCH_URL/" > /dev/null 2>&1; do
  sleep 1
done

echo "CouchDB is up. Creating 'bujo' database..."
curl -sf -X PUT "$COUCH_URL/bujo" > /dev/null 2>&1 || echo "Database 'bujo' already exists."

echo "CouchDB init complete."
