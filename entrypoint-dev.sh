#!/usr/bin/env bash

sed -i -e 's/localhost/ark-postgresql/g' config.devnet.json
sed -i -e 's/"user": null,/"user": "postgres",/g' config.devnet.json
exec "$@"
