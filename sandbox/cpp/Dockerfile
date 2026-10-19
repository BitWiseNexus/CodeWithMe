# C++ sandbox image used by server/sandbox.ts. Build it with:
#   npm run sandbox:images
FROM alpine:3.22

RUN apk add --no-cache g++ musl-dev

# Precompile <bits/stdc++.h> with the exact flags the sandbox compiles with
# (see CPP_FLAGS in server/sandbox.ts). GCC picks up stdc++.h.gch next to the
# header, which cuts a typical compile from seconds to well under one.
RUN HDR="$(find /usr/include/c++ -path '*/bits/stdc++.h' | head -n 1)" \
 && g++ -std=c++17 -O2 -x c++-header "$HDR" -o "$HDR.gch"
