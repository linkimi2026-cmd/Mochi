#requires -Version 5.1
<#
.SYNOPSIS
  Collects a local, privacy-minimized preflight record for one classroom PC.

.DESCRIPTION
  This script is intentionally limited to local CIM hardware facts and two
  unauthenticated HTTPS GET requests. It does not change system configuration,
  install software, read user homes, enumerate files, call a model, or upload
  the result. It writes one JSON file and refuses to overwrite an existing one.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [ValidateNotNullOrEmpty()]
  [string]$OutputPath,

  [Parameter(Mandatory = $false)]
  [ValidateRange(1, 60)]
  [int]$TimeoutSeconds = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$schemaVersion = 'mochi.p0.classroom-preflight.v1'
$endpointDefinitions = @(
  [pscustomobject]@{
    id = 'mimo-models'
    uri = 'https://mimo.ezlook.top/v1/models'
  },
  [pscustomobject]@{
    id = 'campus-auth-me'
    uri = 'https://jyl-campus-health-entry.pages.dev/api/auth/me'
  }
)

function Get-SafeString {
  param([object]$Value)

  if ($null -eq $Value) {
    return $null
  }

  $text = [string]$Value
  if ([string]::IsNullOrWhiteSpace($text)) {
    return $null
  }

  return $text
}

function Get-LocalCimCollection {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ClassName,

    [Parameter(Mandatory = $true)]
    [string[]]$Properties
  )

  try {
    $items = @(Get-CimInstance -ClassName $ClassName -Property $Properties -ErrorAction Stop)
    return [pscustomobject]@{
      succeeded = $true
      items = $items
      errorCategory = $null
    }
  }
  catch {
    return [pscustomobject]@{
      succeeded = $false
      items = @()
      errorCategory = 'cim-query-failed'
    }
  }
}

function Get-HttpClassification {
  param([object]$StatusCode)

  if ($null -eq $StatusCode) {
    return 'unconfirmed'
  }

  if ($StatusCode -ge 300 -and $StatusCode -lt 400) {
    return 'redirect-unconfirmed'
  }

  if ($StatusCode -eq 401) {
    return 'reachable-auth-required'
  }

  if ($StatusCode -eq 403) {
    return 'reachable-http-forbidden-unconfirmed'
  }

  if ($StatusCode -ge 200 -and $StatusCode -lt 300) {
    # A body is deliberately not inspected, so a 2xx response is never an API pass.
    return 'reachable-response-unconfirmed'
  }

  if ($StatusCode -ge 400 -and $StatusCode -lt 500) {
    return 'reachable-http-client-error'
  }

  if ($StatusCode -ge 500 -and $StatusCode -lt 600) {
    return 'reachable-http-server-error'
  }

  return 'reachable-http-status-unconfirmed'
}

function Get-NetworkErrorCategory {
  param([System.Exception]$Exception)

  $current = $Exception
  while ($null -ne $current) {
    if ($current -is [System.Net.WebException]) {
      switch ($current.Status.ToString()) {
        'NameResolutionFailure' { return 'dns-failure' }
        'TrustFailure' { return 'tls-failure' }
        'SecureChannelFailure' { return 'tls-failure' }
        'Timeout' { return 'timeout' }
        'ConnectFailure' { return 'connect-failure' }
        'ProtocolError' { return 'http-protocol-error' }
        default { return 'network-request-failed' }
      }
    }
    $current = $current.InnerException
  }

  return 'request-failed'
}

function Get-ResponseFromException {
  param([System.Exception]$Exception)

  $current = $Exception
  while ($null -ne $current) {
    if ($current -is [System.Net.WebException] -and $null -ne $current.Response) {
      return $current.Response
    }

    $responseProperty = $current.PSObject.Properties['Response']
    if ($null -ne $responseProperty -and $null -ne $responseProperty.Value) {
      return $responseProperty.Value
    }

    $current = $current.InnerException
  }

  return $null
}

function Invoke-UnauthenticatedEndpointProbe {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Endpoint,

    [Parameter(Mandatory = $true)]
    [int]$RequestTimeoutSeconds
  )

  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $statusCode = $null
  $classification = 'unconfirmed'
  $errorCategory = $null

  try {
    # No -Credential, -UseDefaultCredentials, -WebSession, or -SessionVariable is supplied.
    # MaximumRedirection 0 makes a redirect an explicit unconfirmed result.
    $webRequestParameters = @{
      Uri = $Endpoint.uri
      Method = 'Get'
      UseBasicParsing = $true
      MaximumRedirection = 0
      TimeoutSec = $RequestTimeoutSeconds
      DisableKeepAlive = $true
      ErrorAction = 'Stop'
    }
    $response = Invoke-WebRequest @webRequestParameters
    $statusCode = [int]$response.StatusCode
    $classification = Get-HttpClassification -StatusCode $statusCode
  }
  catch {
    $response = Get-ResponseFromException -Exception $_.Exception
    if ($null -ne $response) {
      try {
        $statusCode = [int]$response.StatusCode
      }
      catch {
        $statusCode = $null
      }
      try {
        $response.Close()
      }
      catch {
        # The report records only status/error category, never response content or headers.
      }
      $classification = Get-HttpClassification -StatusCode $statusCode
      if ($null -eq $statusCode) {
        $errorCategory = Get-NetworkErrorCategory -Exception $_.Exception
      }
    }
    else {
      $errorCategory = Get-NetworkErrorCategory -Exception $_.Exception
    }
  }
  finally {
    $stopwatch.Stop()
  }

  return [ordered]@{
    id = $Endpoint.id
    uri = $Endpoint.uri
    method = 'GET'
    authentication = 'none'
    requestCount = 1
    followsRedirects = $false
    timeoutSeconds = $RequestTimeoutSeconds
    statusCode = $statusCode
    elapsedMilliseconds = [int64]$stopwatch.ElapsedMilliseconds
    classification = $classification
    errorCategory = $errorCategory
    responseBodyRecorded = $false
    responseHeadersRecorded = $false
    responseCookiesRecorded = $false
  }
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ', [System.Globalization.CultureInfo]::InvariantCulture)
  $OutputPath = Join-Path -Path (Get-Location).Path -ChildPath ("mochi-classroom-preflight-{0}.json" -f $timestamp)
}

try {
  $resolvedOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
}
catch {
  throw 'Output path is invalid. Choose an existing local directory.'
}

if ($resolvedOutputPath.StartsWith('\\')) {
  throw 'Output path must be on a local volume. UNC paths are not accepted.'
}

$outputRoot = [System.IO.Path]::GetPathRoot($resolvedOutputPath)
try {
  $outputDrive = [System.IO.DriveInfo]::new($outputRoot)
}
catch {
  throw 'Output path must resolve to an available local volume.'
}
if ($outputDrive.DriveType -eq [System.IO.DriveType]::Network) {
  throw 'Output path must be on a local volume. Mapped network drives are not accepted.'
}

if (Test-Path -LiteralPath $resolvedOutputPath) {
  throw 'Output file already exists. Choose a new -OutputPath; this script never overwrites a prior record.'
}

$outputDirectory = Split-Path -Parent $resolvedOutputPath
if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
  throw 'The output directory does not exist. Choose an existing local directory.'
}

$unconfirmedItems = @()

$osResult = Get-LocalCimCollection -ClassName 'Win32_OperatingSystem' -Properties @(
  'Caption', 'Version', 'BuildNumber', 'OSArchitecture', 'TotalVisibleMemorySize'
)
$systemResult = Get-LocalCimCollection -ClassName 'Win32_ComputerSystem' -Properties @('Manufacturer', 'Model')
$memoryResult = Get-LocalCimCollection -ClassName 'Win32_PhysicalMemory' -Properties @('Capacity')
$processorResult = Get-LocalCimCollection -ClassName 'Win32_Processor' -Properties @('NumberOfLogicalProcessors')
$audioResult = Get-LocalCimCollection -ClassName 'Win32_SoundDevice' -Properties @('Status')

$os = [pscustomobject][ordered]@{
  collectionStatus = if ($osResult.succeeded -and $osResult.items.Count -gt 0) { 'collected' } else { 'unconfirmed' }
  errorCategory = if ($osResult.succeeded -and $osResult.items.Count -gt 0) { $null } else { $osResult.errorCategory }
  caption = $null
  version = $null
  buildNumber = $null
  architecture = $null
  osVisibleMemoryKiB = $null
}
if ($osResult.succeeded -and $osResult.items.Count -gt 0) {
  $osItem = $osResult.items[0]
  $os.caption = Get-SafeString -Value $osItem.Caption
  $os.version = Get-SafeString -Value $osItem.Version
  $os.buildNumber = Get-SafeString -Value $osItem.BuildNumber
  $os.architecture = Get-SafeString -Value $osItem.OSArchitecture
  if ($null -ne $osItem.TotalVisibleMemorySize) {
    $os.osVisibleMemoryKiB = [int64]$osItem.TotalVisibleMemorySize
  }
}
else {
  $unconfirmedItems += 'hardware.operatingSystem'
}

$computer = [pscustomobject][ordered]@{
  collectionStatus = if ($systemResult.succeeded -and $systemResult.items.Count -gt 0) { 'collected' } else { 'unconfirmed' }
  errorCategory = if ($systemResult.succeeded -and $systemResult.items.Count -gt 0) { $null } else { $systemResult.errorCategory }
  manufacturer = $null
  model = $null
}
if ($systemResult.succeeded -and $systemResult.items.Count -gt 0) {
  $computerItem = $systemResult.items[0]
  $computer.manufacturer = Get-SafeString -Value $computerItem.Manufacturer
  $computer.model = Get-SafeString -Value $computerItem.Model
}
else {
  $unconfirmedItems += 'hardware.computerSystem'
}

$installedMemoryBytes = $null
if ($memoryResult.succeeded) {
  $memoryValues = @()
  foreach ($memoryItem in $memoryResult.items) {
    if ($null -ne $memoryItem.Capacity) {
      $memoryValues += [int64]$memoryItem.Capacity
    }
  }
  if ($memoryValues.Count -gt 0) {
    $installedMemoryBytes = [int64](($memoryValues | Measure-Object -Sum).Sum)
  }
}
if ($null -eq $installedMemoryBytes) {
  $unconfirmedItems += 'hardware.installedMemory'
}

$logicalCoreCount = $null
if ($processorResult.succeeded) {
  $coreValues = @()
  foreach ($processorItem in $processorResult.items) {
    if ($null -ne $processorItem.NumberOfLogicalProcessors) {
      $coreValues += [int64]$processorItem.NumberOfLogicalProcessors
    }
  }
  if ($coreValues.Count -gt 0) {
    $logicalCoreCount = [int64](($coreValues | Measure-Object -Sum).Sum)
  }
}
if ($null -eq $logicalCoreCount) {
  $unconfirmedItems += 'hardware.logicalProcessorCount'
}

$audio = [pscustomobject][ordered]@{
  enumerationStatus = if ($audioResult.succeeded) { 'collected' } else { 'unconfirmed' }
  errorCategory = if ($audioResult.succeeded) { $null } else { $audioResult.errorCategory }
  audioDeviceCount = if ($audioResult.succeeded) { [int]$audioResult.items.Count } else { $null }
  microphoneRecordingVerified = $false
  note = 'Audio-device enumeration does not verify microphone recording or classroom audio quality.'
}
$unconfirmedItems += 'audio.microphoneRecording'

$endpointResults = @()
foreach ($endpoint in $endpointDefinitions) {
  $endpointResult = Invoke-UnauthenticatedEndpointProbe -Endpoint $endpoint -RequestTimeoutSeconds $TimeoutSeconds
  $endpointResults += $endpointResult
  $unconfirmedItems += ("network.{0}.authenticatedApiBehavior" -f $endpoint.id)
  if ($endpointResult.classification -eq 'unconfirmed' -or $endpointResult.classification -eq 'redirect-unconfirmed') {
    $unconfirmedItems += ("network.{0}.reachability" -f $endpoint.id)
  }
}

$unconfirmedItems += 'storage.restoreCard'
$uniqueUnconfirmedItems = @($unconfirmedItems | Sort-Object -Unique)

$report = [ordered]@{
  schemaVersion = $schemaVersion
  collectedAtUtc = (Get-Date).ToUniversalTime().ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
  collection = [ordered]@{
    mode = 'manual-local-read-only'
    powershellEdition = $PSVersionTable.PSEdition
    powershellVersion = $PSVersionTable.PSVersion.ToString()
    outputOverwritten = $false
    automaticUploadPerformed = $false
    modelRequestPerformed = $false
  }
  hardware = [ordered]@{
    operatingSystem = $os
    computerSystem = $computer
    cpu = [ordered]@{
      collectionStatus = if ($null -ne $logicalCoreCount) { 'collected' } else { 'unconfirmed' }
      logicalProcessorCount = $logicalCoreCount
    }
    memory = [ordered]@{
      installedMemoryBytes = $installedMemoryBytes
      osVisibleMemoryKiB = $os.osVisibleMemoryKiB
      note = 'Installed physical-memory module capacity and OS-visible memory are intentionally separate measurements.'
    }
    audio = $audio
  }
  restoreCard = [ordered]@{
    status = 'manual-confirmation-needed'
    automaticallyDetected = $false
    note = 'No automatic restore-card or device-management detection is attempted.'
  }
  network = [ordered]@{
    endpoints = $endpointResults
    note = 'Requests are unauthenticated single GET attempts. Response bodies, headers, cookies, credentials, and redirects are not retained.'
  }
  overall = [ordered]@{
    status = 'review-required'
    automaticClassroomReadinessPass = $false
    unconfirmedItems = $uniqueUnconfirmedItems
  }
}

$fileStream = $null
$streamWriter = $null
try {
  $json = $report | ConvertTo-Json -Depth 10
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  # The earlier Test-Path is only an early user-facing check. CreateNew makes
  # the final write non-overwriting even if a file appears during collection.
  $fileStream = [System.IO.File]::Open($resolvedOutputPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  $streamWriter = [System.IO.StreamWriter]::new($fileStream, $utf8NoBom)
  $streamWriter.Write($json)
  $streamWriter.Flush()
}
catch {
  throw 'Could not create the local JSON record. No existing record was overwritten.'
}
finally {
  if ($null -ne $streamWriter) {
    $streamWriter.Dispose()
  }
  elseif ($null -ne $fileStream) {
    $fileStream.Dispose()
  }
}

Write-Output 'Mochi classroom preflight JSON was written locally.'
Write-Output ("Review required: {0} item(s) remain unconfirmed; this tool never marks classroom readiness as passed." -f $uniqueUnconfirmedItems.Count)
