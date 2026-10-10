$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskData = Join-Path $taskRoot '.local\mongo'
New-Item -ItemType Directory -Force -Path $taskData | Out-Null
$taskMongo = Get-Command mongod.exe -ErrorAction SilentlyContinue
if ($taskMongo) { $taskMongoPath = $taskMongo.Source }
elseif (Test-Path 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe') { $taskMongoPath = 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe' }
else { throw 'MongoDB is not installed. Install MongoDB Community or set MONGODB_URI to your MongoDB instance.' }
& $taskMongoPath --dbpath $taskData --bind_ip 127.0.0.1 --port 27019 --logpath (Join-Path $taskRoot '.local\mongo.log')
