# Loads a td2d SpriteFrames resource with Godot's own loader and prints what Godot sees.
# Run by scripts/godot/check.sh; the expected values come from the td2d manifest.
extends SceneTree

func _init() -> void:
	var path := OS.get_environment("TD2D_TRES")
	var frames := load(path) as SpriteFrames
	if frames == null:
		printerr("LOAD FAILED: ", path)
		quit(1)
		return
	var names := frames.get_animation_names()
	print("animations=", names.size())
	for n in names:
		var tex := frames.get_frame_texture(n, 0) as AtlasTexture
		print("anim=", n, " frames=", frames.get_frame_count(n), " speed=", frames.get_animation_speed(n), " loop=", frames.get_animation_loop(n), " region=", tex.region, " margin=", tex.margin, " size=", tex.get_size(), " atlas=", tex.atlas.get_size())
	quit(0)
