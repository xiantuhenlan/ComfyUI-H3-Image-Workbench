"""Independent H3 image workbench based on the copied MOSS node."""
from .moss_image_asset_workbench import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from . import services as _services

__version__ = "0.1.0"
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
