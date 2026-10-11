"""explain-change: architecture-first visual explanation of a code change. Python stdlib only.

The script decides everything structural (components, dependency edges, rule violations, section order, diagrams).
An agent of any vendor only writes a small, validated `insight.json`: intent, the story, decisions and data flows.

Modules, in pipeline order: config → diff → deps → openspec → collect → digest → (agent) → insight → render; cli wires
them into commands. This package re-exports their public names for the tests and for scripting.
"""
from .constants import *  # noqa: F401,F403
from .util import *  # noqa: F401,F403
from .config import *  # noqa: F401,F403
from .diff import *  # noqa: F401,F403
from .deps import *  # noqa: F401,F403
from .openspec import *  # noqa: F401,F403
from .collector import *  # noqa: F401,F403
from .insight import *  # noqa: F401,F403
from .digest import *  # noqa: F401,F403
from .render import *  # noqa: F401,F403
from .cli import *  # noqa: F401,F403
