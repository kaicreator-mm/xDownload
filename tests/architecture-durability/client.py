#!/usr/bin/env python3
import argparse, json, socket, sys
ap=argparse.ArgumentParser(); ap.add_argument("--socket",required=True); ap.add_argument("--request",required=True); a=ap.parse_args()
s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM); s.connect(a.socket); s.sendall((a.request+"\n").encode()); f=s.makefile("r"); line=f.readline();
if line: print(line.strip())
else: sys.exit(3)
