FROM debian:trixie-20250224 AS system-build

RUN echo 123 && apt-get update && apt-get upgrade -y

RUN apt-get install -y curl

RUN curl -fsSL https://deb.nodesource.com/setup_23.x | bash -

RUN apt-get install -y \
    nodejs \
    libfuse2 fuse \
    kmod \
    systemd \
    udev \
    build-essential \
    make \
    g++ \
    git \
    python3 \
    openssh-server

RUN echo "root:root" | chpasswd
RUN useradd -m -s /bin/bash dev
RUN echo "dev:dev" | chpasswd dev

USER root

RUN rm -rf /etc/systemd/network
COPY --chown=root:root system-image/etc/systemd/network /etc/systemd/network
COPY --chown=root:root system-image/etc/systemd/system/remote-usb-storage-gadget.service /etc/systemd/system/remote-usb-storage-gadget.service
COPY --chown=root:root system-image/etc/modules-load.d /etc/modules-load.d
COPY --chown=root:root system-image/init /init

RUN mkdir /data
RUN mkdir /lib/modules
RUN mkdir /mnt/overlays

RUN rm -rf /etc/ssh/ssh_host_*
RUN ln -s /data/system/ssh/ssh_host_ecdsa_key /etc/ssh/ssh_host_ecdsa_key
RUN ln -s /data/system/ssh/ssh_host_ecdsa_key.pub /etc/ssh/ssh_host_ecdsa_key.pub
RUN ln -s /data/system/ssh/ssh_host_ed25519_key /etc/ssh/ssh_host_ed25519_key
RUN ln -s /data/system/ssh/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_ed25519_key.pub
RUN ln -s /data/system/ssh/ssh_host_rsa_key /etc/ssh/ssh_host_rsa_key
RUN ln -s /data/system/ssh/ssh_host_rsa_key.pub /etc/ssh/ssh_host_rsa_key.pub

RUN systemctl enable systemd-networkd
RUN systemctl enable ssh
RUN systemctl enable remote-usb-storage-gadget

USER dev
WORKDIR /home/dev

COPY --chown=dev:dev . /home/dev/remote-usb-storage-gadget
WORKDIR /home/dev/remote-usb-storage-gadget

RUN npm ci

FROM debian:bookworm AS system-squashfs-build

USER root

RUN apt-get update && apt-get install -y squashfs-tools

COPY --from=system-build / /rootfs
WORKDIR /
RUN mkdir /build
RUN mksquashfs rootfs /build/system.squashfs


FROM debian:bookworm AS system-ext4-build

USER root

RUN apt-get update && apt-get install -y e2fsprogs

COPY --from=system-build / /rootfs
WORKDIR /
RUN mkdir /build
RUN touch /build/system.ext4 && truncate -s 6G /build/system.ext4
RUN mke2fs -t ext4 -d rootfs /build/system.ext4

FROM scratch

COPY --from=system-squashfs-build /build/system.squashfs /system.squashfs
# COPY --from=system-ext4-build /build/system.ext4 /system.ext4
