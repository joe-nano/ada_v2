generate_cad_prototype_tool = {
    "name": "generate_cad_prototype",
    "description": "Generates a 3D wireframe prototype based on a user's description. Use this when the user asks to 'visualize', 'prototype', 'create a wireframe', or 'design' something in 3D.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "prompt": {
                "type": "STRING",
                "description": "The user's description of the object to prototype."
            }
        },
        "required": ["prompt"]
    }
}




write_file_tool = {
    "name": "write_file",
    "description": "Writes content to a file at the specified path. Overwrites if exists. Prefer writing inside the current project folder unless explicitly asked otherwise.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "path": {
                "type": "STRING",
                "description": "The path of the file to write to."
            },
            "content": {
                "type": "STRING",
                "description": "The content to write to the file."
            }
        },
        "required": ["path", "content"]
    }
}

read_directory_tool = {
    "name": "read_directory",
    "description": "Lists the contents of a directory. Projects are real folders on disk; use this to browse the active project or other project folders under the workspace.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "path": {
                "type": "STRING",
                "description": "The path of the directory to list."
            }
        },
        "required": ["path"]
    }
}

read_file_tool = {
    "name": "read_file",
    "description": "Reads the content of a file. Prefer reading files inside the active project folder unless explicitly asked otherwise.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "path": {
                "type": "STRING",
                "description": "The path of the file to read."
            }
        },
        "required": ["path"]
    }
}

generate_image_tool = {
    "name": "generate_image",
    "description": "Generates an image from a text description using AI. Use this when the user asks to 'generate an image', 'create a picture', 'draw', 'make an image', or 'visualize' something as a 2D image (not 3D CAD). The generated image will be displayed in the Media Gallery.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "prompt": {
                "type": "STRING",
                "description": "Detailed description of the image to generate. Be specific about style, colors, composition, and subject."
            }
        },
        "required": ["prompt"]
    }
}

generate_video_tool = {
    "name": "generate_video",
    "description": "Generates a short video clip from a text description using AI. Use this when the user asks to 'generate a video', 'create a video clip', 'make a video', or 'animate' something.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "prompt": {
                "type": "STRING",
                "description": "Detailed description of the video to generate."
            }
        },
        "required": ["prompt"]
    }
}

tools_list = [{"function_declarations": [
    generate_cad_prototype_tool,
    generate_image_tool,
    generate_video_tool,
    write_file_tool,
    read_directory_tool,
    read_file_tool
]}]

