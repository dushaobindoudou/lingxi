"""Small stdio MCP client for the installed official Blender Lab server.
Run using .local/blender-mcp-venv/bin/python. No direct socket bypass.
"""
import argparse
import base64
import asyncio
import json
import os
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tool', default='get_blendfile_summary_datablocks')
    parser.add_argument('--arguments', default='{}')
    parser.add_argument('--code-file', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--image-output', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    env = {**os.environ, 'BLENDER_MCP_HOST':'127.0.0.1', 'BLENDER_MCP_PORT':'9877', 'BLENDER_PATH':'/Applications/Blender.app/Contents/MacOS/Blender'}
    params = StdioServerParameters(command=str(root/'.local/blender-mcp-venv/bin/blender-mcp'), env=env)
    async with stdio_client(params) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            init = await session.initialize()
            tools = await session.list_tools()
            arguments = json.loads(args.arguments)
            if args.code_file:
                arguments['code'] = '__file__ = ' + repr(str(args.code_file.resolve())) + '\n' + args.code_file.read_text()
            result = await session.call_tool(args.tool, arguments)
            report = {'server':init.serverInfo.model_dump(), 'tools':[t.name for t in tools.tools], 'tool':args.tool, 'response':result.model_dump(mode='json')}
            if args.image_output:
                for content in result.content:
                    if content.type == 'image':
                        args.image_output.parent.mkdir(parents=True, exist_ok=True)
                        args.image_output.write_bytes(base64.b64decode(content.data))
                for content in report['response']['content']:
                    if content['type'] == 'image':
                        content['data'] = '[saved to image-output]'
            text = json.dumps(report, ensure_ascii=False, indent=2)
            if args.output:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(text+'\n')
            print(text)
            failed = bool(result.isError)
            for content in result.content:
                if content.type=='text':
                    try:
                        value=json.loads(content.text)
                    except ValueError:
                        continue
                    if isinstance(value,dict) and value.get('status')=='error':
                        failed = True

    return 1 if failed else 0

raise SystemExit(asyncio.run(main()))
