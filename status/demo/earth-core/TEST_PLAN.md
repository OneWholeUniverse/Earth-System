# Earth Core Test Plan

This checklist defines the behavior `earth-core` should guarantee for apps that layer on top of it.
The first implementation target should be Playwright browser tests, with a small number of lower-level
API assertions executed inside the page context.

## Test Harness

- Start a local static server from `status/demo`.
- Open `earth-core/earth_core.html`.
- Wait for `window.EarthSystem` and the `earthsystem:ready` event.
- Capture browser console errors and failed network requests.
- Run core tests at desktop and mobile-sized viewports.
- Prefer fast API calls for state transitions, and use real pointer/wheel/touch events for interaction contracts.

## Smoke And Boot

- Loads without uncaught page errors.
- Exposes `window.EarthSystem`.
- Reports `EarthSystem.version`.
- Dispatches `earthsystem:ready` exactly once during boot.
- Provides the expected public API:
  `getState`, `on`, `flyToTarget`, `flyToLocation`, `switchToMicro`, `switchToMacro`,
  `latLngToVec`, `addThreeLayer`, `removeThreeLayer`, `addMapLayer`, `removeMapLayer`,
  `registerLayer`, `unregisterLayer`, and `map`.
- Provides the expected public scene objects:
  `scene`, `camera`, `renderer`, `earthGroup`, `earth`, `moon`, `sun`, and `sunGroup`.
- Initial state is globe mode with target `earth`.
- Initial UI shows the Earth target as active.
- Canvas is visible and the map container is hidden on boot.
- The WebGL canvas is not blank after the first rendered frames.

## Asset Loading

- Requests the Earth day texture from `assets/textures/earth-blue-marble.jpg`.
- Requests the Earth night texture from `assets/textures/earth-night.jpg`.
- Requests the Earth normal and specular textures.
- Requests the Moon texture from `assets/textures/moon-8k.jpg`.
- Requests the Sun texture from `assets/textures/sun_disk.jpg`.
- No core texture request returns 404.
- `EarthSystem.config.assets` resolves to usable URLs.
- Overriding `window.EARTH_CORE_ASSET_BASE` before loading core redirects asset URLs.

## Target Dropdown UI

- Clicking the target button opens the dropdown.
- Clicking outside the dropdown closes it.
- Selecting Earth closes the dropdown, marks Earth active, and emits `targetchange`.
- Selecting Moon closes the dropdown, marks Moon active, and emits `targetchange`.
- Selecting Sun closes the dropdown, marks Sun active, and emits `targetchange`.
- Re-selecting a target does not leave duplicate active dropdown items.
- Target button label reflects the current target after each selection.
- The target UI is hidden in map mode and restored in globe mode.

## Target Flight Behavior

- `flyToTarget('earth')` eventually sets `getState().target` to `earth`.
- `flyToTarget('moon')` eventually sets `getState().target` to `moon`.
- `flyToTarget('sun')` eventually sets `getState().target` to `sun`.
- Invalid targets are ignored and do not throw.
- Starting a target flight while in map mode first returns to globe mode.
- Target flights keep camera radius finite and positive throughout the transition.
- Moon target keeps Earth scaled down according to target config after flight settles.
- Sun target scales the Sun into the detailed/cinematic view after flight settles.
- Earth target restores Earth scale and natural Sun orb mode after flight settles.
- Target flights emit `targetchange` with the selected target name.

## Globe Pointer And Wheel Controls

- Dragging on the canvas changes `getState().orbit.theta` or `phi`.
- Pointer release stops dragging; a later pointer move without a pressed pointer does not continue orbiting.
- Pointer leave stops dragging.
- Dragging clamps `orbit.phi` inside the configured vertical bounds.
- Wheel zoom changes `getState().orbit.radius` in globe mode.
- Wheel zoom does nothing during active flight.
- Wheel zoom does nothing in map mode.
- Zoom radius is clamped between the current target min and max radius.
- Deep Earth zoom crosses into map mode when the screen center intersects Earth.
- The Earth zoom path approaches directly rather than following an unwanted side arc.

## Touch Controls

- Two-finger touch starts pinch mode in globe view.
- Pinch-in and pinch-out adjust orbit radius.
- Pinch gestures prevent default page behavior.
- Ending or cancelling touch resets pinch state.
- Single-touch movement after a pinch does not leave the system stuck in pinch mode.
- Touch gestures are ignored while in map mode.

## 3D To 2D Map Transition

- `switchToMicro(lat, lng, { zoom })` adds `micro-view` to `document.body`.
- In micro view, the WebGL canvas becomes hidden/non-interactive and the map container becomes visible/interactive.
- `getState().mode` reports `map`.
- `EarthSystem.map()` returns a MapLibre map instance after switching to micro view.
- The map center and zoom match the requested latitude, longitude, and zoom.
- `switchToMicro` emits `viewchange` with mode `map`, latitude, longitude, and zoom.
- Repeated `switchToMicro` calls reuse the same map instance and update center/zoom.
- The map resizes after entering micro view.
- Zooming the map below the exit threshold calls `switchToMacro`.

## 2D To 3D Map Exit

- `switchToMacro()` removes `micro-view` from `document.body`.
- In macro view, the WebGL canvas is visible and the map container is hidden/non-interactive.
- `getState().mode` reports `globe`.
- `switchToMacro` emits `viewchange` with mode `globe`.
- Exiting to macro keeps camera state finite and renderable.
- Returning to macro preserves the existing MapLibre instance for later reuse.

## Fly To Location

- `flyToLocation({ lat, lng })` emits `flytolocation`.
- `flyToLocation` ignores non-finite latitude or longitude and does not throw.
- During the flight, camera position remains finite.
- With `enterMap: false`, the final mode remains globe.
- With `enterMap: true`, the final mode is map and the map centers on the requested location.
- `mapZoom` is honored when `enterMap` is true.
- `duration` is honored well enough for tests to run short deterministic flights.
- Starting `flyToLocation` while target is Moon or Sun resets the target to Earth.
- Starting `flyToLocation` while another target flight is active cancels the prior flight cleanly.

## Map Layer API

- `addMapLayer(id, definition)` stores a layer definition before MapLibre has loaded.
- Stored map layers install after the map emits `load`.
- `addMapLayer` emits `layeradd` with type `map`.
- Adding a map layer after map load installs the source and layers immediately.
- Removing a map layer removes its MapLibre layers in reverse order.
- Removing a map layer removes its source.
- `removeMapLayer` emits `layerremove` with type `map`.
- Removing an unknown map layer returns `false` and does not throw.
- Re-adding the same map layer id replaces the stored definition predictably.

## Three Layer API

- `addThreeLayer(id, object)` adds the object to `earthGroup` by default.
- `addThreeLayer(id, object, { parent: 'scene' })` adds the object to `scene`.
- `addThreeLayer` emits `layeradd` with type `three`.
- Re-adding the same id removes the previous object before adding the new one.
- Registered layer `update` callbacks run during `beforeRender`/animation frames.
- `removeThreeLayer(id)` removes the object from its parent.
- `removeThreeLayer` emits `layerremove` with type `three`.
- Removing an unknown three layer returns `false` and does not throw.

## App Layer API

- `registerLayer(id, layer)` returns a mounted layer record.
- `registerLayer` mounts `threeObject` layers under `${id}:three`.
- `registerLayer` mounts `mapDefinition` layers under `${id}:map`.
- `registerLayer` calls `layer.mount(EarthSystem)` once.
- `registerLayer` emits `layerregister`.
- Re-registering the same app layer id unregisters the previous layer first.
- `unregisterLayer(id)` calls `layer.unmount(EarthSystem)` once.
- `unregisterLayer` removes the mounted three layer.
- `unregisterLayer` removes the mounted map layer.
- `unregisterLayer` emits `layerunregister`.
- Unregistering an unknown app layer returns `false` and does not throw.

## Event API

- `on(eventName, handler)` subscribes to events.
- The unsubscribe function removes the handler.
- Event callback receives `{ type, detail, state }`.
- `ready`, `targetchange`, `viewchange`, `flytolocation`, `mapload`, `layeradd`,
  `layerremove`, `layerregister`, `layerunregister`, and `beforeRender` are observable.
- `beforeRender` fires while in globe mode.
- Event handlers throwing errors should not prevent unrelated handlers from running.  
  This is a desired contract; if current behavior differs, add this as a future hardening test.

## Coordinate Helpers

- `latLngToVec(0, 0, 1)` returns a unit-length vector.
- `latLngToVec(90, 0, 1)` points near positive Y.
- `latLngToVec(-90, 0, 1)` points near negative Y.
- `latLngToVec(lat, lng, radius)` returns a vector with the requested radius.
- `latLngToVec` handles longitudes near `-180`, `0`, and `180` consistently.
- Returned vectors use the same coordinate convention expected by layer authors.

## Visual Scene Invariants

- Earth mesh exists and has day, normal, and specular material maps.
- Night-side overlay exists and tracks Sun direction.
- Atmosphere and aurora materials exist and animate over time.
- Moon exists, moves over time, and remains finite.
- Sun exists as both light and visible Sun group.
- Star field and Milky Way are present in the scene.
- The Sun appears as a simple natural orb from Earth and Moon targets.
- The detailed Sun surface is visible only when focused on the Sun target.

## Responsive Behavior

- Resizing the viewport updates renderer size.
- Resizing updates camera aspect and projection matrix.
- Resizing in map mode calls map resize.
- Desktop viewport renders without overlapping the target dropdown.
- Mobile viewport renders without clipping the target dropdown.
- Mobile viewport can enter and exit map mode.

## Failure And Compatibility Contracts

- Core can load without optional app layers.
- Core warns but does not crash if MapLibre is unavailable and map mode is requested.
- Core should fail loudly enough if required DOM nodes are missing.  
  This can become a documented setup requirement or a future graceful-error behavior.
- No global names are exported except `window.EarthSystem` and documented configuration hooks.
- Tests should not depend on external OSM tile availability unless explicitly marked integration-only.

