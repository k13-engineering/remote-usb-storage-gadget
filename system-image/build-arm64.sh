#!/bin/sh

cd "$(dirname "$0")"
mkdir -p build/arm64 && rm -rf build/arm64 && mkdir -p build/arm64

docker buildx build --platform linux/arm64/v8 --build-arg NODE_TARBALL=https://nodejs.org/dist/v25.2.1/node-v25.2.1-linux-arm64.tar.xz -f Dockerfile --output type=local,dest=build/arm64/ ../
