#!/bin/bash
# Open-Doubao-Onboarding.command — Finder 里双击即可运行的一键唤起豆包接入向导。
# 等价于：bash open-in-doubao.sh
cd "$(dirname "${BASH_SOURCE[0]}")"
exec bash open-in-doubao.sh
