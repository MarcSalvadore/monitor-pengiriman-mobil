-- OSRM Car Profile: Toll-Enabled (car-toll.lua)
-- Prioritizes Jabodetabek tollways (motorway / motorway_link) over urban arterials.

package.path = "/opt/?.lua;" .. package.path
local car = dofile("/opt/car.lua")

local original_setup = car.setup

function car.setup()
  local profile = original_setup()
  if profile.speeds and profile.speeds.highway then
    profile.speeds.highway.motorway = 100
    profile.speeds.highway.motorway_link = 65
    profile.speeds.highway.trunk = 55
    profile.speeds.highway.trunk_link = 35
    profile.speeds.highway.primary = 45
    profile.speeds.highway.primary_link = 25
  end
  return profile
end

setup = car.setup

return car
