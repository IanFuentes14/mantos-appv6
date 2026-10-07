param(
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$AndroidSdk = $env:ANDROID_HOME,
    [switch]$OriginalPackage
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$containerRoot = Join-Path $projectRoot 'build-apk-nuevo/tasa-riego-apk'
$androidRoot = Join-Path $containerRoot 'android'
$node = (Get-Command node -ErrorAction Stop).Source

if (-not $JavaHome) {
    $portableJdk = Get-ChildItem (Join-Path $projectRoot 'output/tools') -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($portableJdk) { $JavaHome = $portableJdk.FullName }
}
if (-not $JavaHome -or -not (Test-Path (Join-Path $JavaHome 'bin/java.exe'))) {
    throw 'Indique Java 17: -JavaHome <carpeta del JDK> o JAVA_HOME.'
}
if (-not $AndroidSdk) { $AndroidSdk = $env:ANDROID_SDK_ROOT }
if (-not $AndroidSdk) { $AndroidSdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
if (-not (Test-Path (Join-Path $AndroidSdk 'platforms/android-34/android.jar'))) {
    throw 'Se requiere Android SDK con la plataforma android-34. Use -AndroidSdk <carpeta>.'
}
$vite = Join-Path $projectRoot 'node_modules/vite/bin/vite.js'
$capacitor = Join-Path $containerRoot 'node_modules/@capacitor/cli/bin/capacitor'
foreach ($dependency in @($vite, $capacitor)) {
    if (-not (Test-Path $dependency)) { throw "Faltan dependencias: $dependency. Ejecute npm ci en ambas carpetas del proyecto." }
}

$previousJava = $env:JAVA_HOME
$previousAndroid = $env:ANDROID_HOME
try {
    $env:JAVA_HOME = $JavaHome
    $env:ANDROID_HOME = $AndroidSdk
    Push-Location $projectRoot
    try {
        & $node $vite build
        if ($LASTEXITCODE -ne 0) { throw 'Fallo al compilar la interfaz.' }
    } finally { Pop-Location }

    # Only replace the generated web directory inside this Android container.
    $webRoot = [IO.Path]::GetFullPath((Join-Path $containerRoot 'www'))
    $expectedWebRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'build-apk-nuevo/tasa-riego-apk/www'))
    if ($webRoot -ne $expectedWebRoot) { throw 'Ruta de recursos web inesperada.' }
    if (Test-Path $webRoot) { Remove-Item -LiteralPath $webRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $webRoot -Force | Out-Null
    Copy-Item -Path (Join-Path $projectRoot 'dist/*') -Destination $webRoot -Recurse -Force

    Push-Location $containerRoot
    try {
        & $node $capacitor sync android
        if ($LASTEXITCODE -ne 0) { throw 'Fallo al sincronizar Android.' }
    } finally { Pop-Location }

    Push-Location $androidRoot
    try {
        $buildTask = if ($OriginalPackage) { 'assembleDebug' } else { 'assembleStandalone' }
        & .\gradlew.bat --no-daemon $buildTask
        if ($LASTEXITCODE -ne 0) { throw 'Fallo al compilar el APK.' }
    } finally { Pop-Location }

    $apkRelativePath = if ($OriginalPackage) { 'app/build/outputs/apk/debug/app-debug.apk' } else { 'app/build/outputs/apk/standalone/app-standalone.apk' }
    $apkSource = Join-Path $androidRoot $apkRelativePath
    $outputDirectory = Join-Path $projectRoot 'output'
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    $apkFilename = if ($OriginalPackage) { 'mantos-group-v6-debug.apk' } else { 'mantos-group-v6-sin-conflicto.apk' }
    $apkDestination = Join-Path $outputDirectory $apkFilename
    Copy-Item -LiteralPath $apkSource -Destination $apkDestination -Force
    Get-FileHash -LiteralPath $apkDestination -Algorithm SHA256
    Write-Host "APK generado: $apkDestination"
} finally {
    $env:JAVA_HOME = $previousJava
    $env:ANDROID_HOME = $previousAndroid
}
