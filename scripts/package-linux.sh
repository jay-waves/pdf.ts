#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

format=$1
version=$(node -p "require('./package.json').version")
case "$format" in
  deb) output="release/pdf-ts_${version}_amd64.deb" ;;
  rpm) output="release/pdf-ts-${version}-1.x86_64.rpm" ;;
esac

PDF_TS_VERSION=$version "${PDF_TS_NFPM:-nfpm}" package \
  --config packaging/linux/nfpm.yaml \
  --packager "$format" \
  --target "$output"
