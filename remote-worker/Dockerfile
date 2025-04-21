FROM debian:trixie-20250317

RUN apt-get update && apt-get upgrade -y

RUN apt-get install -y curl

RUN curl -fsSL https://deb.nodesource.com/setup_23.x | bash -

RUN apt-get install -y build-essential nodejs make g++ git

RUN apt-get install -y kmod

RUN apt-get install -y libfuse2 fuse

RUN mkdir /lib/modules

RUN useradd -m -s /bin/bash dev
RUN echo "dev:dev" | chpasswd dev
RUn echo "root:root" | chpasswd

USER dev
RUN mkdir /home/dev/projects

RUN mkdir /home/dev/remote-usb-storage-gadget-modules/
WORKDIR /home/dev/remote-usb-storage-gadget-modules/

COPY --chown=dev package.json package-lock.json .
RUN npm ci
