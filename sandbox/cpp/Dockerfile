# C++ sandbox image. Built by `npm run sandbox:images`, which passes the build
# args from sandbox/runtimes.json — change the flags there, not here.
FROM alpine:3.22

RUN apk add --no-cache g++ musl-dev

# Compiler flags: baked into the image as $CXXFLAGS, which the runtime's
# `compile` command uses — so the precompiled header below always matches.
ARG CXXFLAGS="-std=c++17 -O2"
ENV CXXFLAGS=$CXXFLAGS

# Precompile <bits/stdc++.h> with those flags. GCC picks up stdc++.h.gch next
# to the header, which cuts a typical compile from seconds to well under one.
RUN HDR="$(find /usr/include/c++ -path '*/bits/stdc++.h' | head -n 1)" \
 && g++ $CXXFLAGS -x c++-header "$HDR" -o "$HDR.gch"
