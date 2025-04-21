#!/bin/sh

cd "$(dirname "$0")"
mkdir -p build/x86_64/ && rm -rf build/x86_64 && mkdir -p build/x86_64/

docker buildx build --platform linux/amd64 -f Dockerfile --output type=local,dest=build/x86_64/ ../
