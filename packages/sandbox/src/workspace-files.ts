// Open relative to pinned directory descriptors and reject symlinks at every level.
// O_NONBLOCK avoids blocking on special files before fstat can reject them.
export const READ_WORKSPACE_FILE = `
import os
import stat
import sys

workspace, relative_path, size_limit = sys.argv[1:]
limit = int(size_limit)
directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
try:
    directory = os.open(workspace, directory_flags)
    for segment in relative_path.split("/")[:-1]:
        child = os.open(segment, directory_flags, dir_fd=directory)
        os.close(directory)
        directory = child
    fd = os.open(relative_path.split("/")[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    with os.fdopen(fd, "rb") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode):
            sys.exit(1)
        if info.st_size > limit:
            sys.exit(2)
        data = source.read(limit + 1)
        if len(data) > limit:
            sys.exit(2)
        sys.stdout.buffer.write(data)
except OSError:
    sys.exit(1)
`;
