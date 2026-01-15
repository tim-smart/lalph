#!/bin/bash

git fetch origin
git checkout origin/main
direnv allow
pnpm install
git submodule update --init --recursive
