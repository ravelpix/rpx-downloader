# Ravelpix Photo Downloader

Allows users to download resized photos from Ravelpix.

Given an id for a photo, it forces a download in the browser of that photo.

The filename of the photo is retrieved from the Ravelpix API.

Filenames are always determined in the context of the album the photo is
currently being retrieved in. If no album is provided, then an error message
is displayed.

## Endpoints

Dev: https://et38wpo387.execute-api.us-east-1.amazonaws.com/dev/download

## Deployment

### App Deploy

If changes have been made to the serverless.yml, you need to deploy the entire app.

#### Development Deploy
    $ nvm use v14.17.4
    $ export AWS_PROFILE=ravelpix
    $ rm -rf node_modules/sharp && SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install --arch=x64 --platform=linux --libc=glibc sharp && sls deploy --stage dev

#### Production Deploy
    $ nvm use v14.17.4
    $ export AWS_PROFILE=ravelpix
    $ rm -rf node_modules/sharp && SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install --arch=x64 --platform=linux --libc=glibc sharp && sls deploy --stage prod

### Function deploy

If no changes made to serverless.yml, just deploy the function.

    $ sls deploy function -f zip --stage prod


## Local development

### Installation

    $ npm install -g serverless

Sharp requires lib/vips. This needs to be installed with homebrew:

    $ brew install vips

Some dependencies are not currently working with node 16. Use nvm to install a previous version:

As of 2021-08-05, version 14.17.4 is the latest 

    $ nvm install v14.17.4
    $ nvm use v14.17.4

Sharp must be built using the linux platform.

The target version has got to match up with the runtime node version, withc is also being specified
in the serverless.yml provider.runtime

    $ npm install --arch=x64 --platform=linux --target=14.17.4 sharp --save


### Local development

Need to run local api using ngrok:

    $ cd ~/ravelpix-api && rails s -b 0.0.0.0
    $ cd ~/rpx-downloader
    $ ngrok http 3000
     

Once ngrok is up and running you need to copy the 'Forwarding' address 
assigned by ngrok into the serverless.yml custom.env.dev.apiEndpoint.

You can then test your function locally by using the following command:

    $ nvm use v14.17.4
    $ export AWS_PROFILE=ravelpix
    $ serverless invoke local --function download --path event.mock.json

The event.mock.json file should contain something like the following:

{
  "queryStringParameters": {
    "photoId": "1106567c-bd13-4ea3-b840-e442f23d924e",
    "albumId":"178ce96a-a9f3-470f-8846-5217cb0b7469",
    "width": "100"
  },
  "headers": { "Authorization": "Bearer JWT_TOKEN_HERE" }
}

You will need to replace the :jwtTokenHere with a value that will work. You can get this token from the ops app.

You can also deploy as dev, and the endpoint can be found here:

