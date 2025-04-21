#!/bin/sh

cd "$(dirname "$0")"
mkdir -p build/arm64 && rm -rf build/arm64 && mkdir -p build/arm64

docker buildx build --platform linux/arm64/v8 -f Dockerfile --output type=local,dest=build/arm64/ ../
